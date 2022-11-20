// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.

use deno_core::error::AnyError;
use deno_core::include_js_files;
use deno_core::op;
use deno_core::url;
use deno_core::AsyncRefCell;
use deno_core::CancelHandle;
use deno_core::CancelFuture;
use deno_core::Extension;
use deno_core::OpState;
use deno_core::RcRef;
use deno_core::Resource;
use deno_core::ResourceId;
use deno_core::ZeroCopyBuf;
use deno_tls::create_client_config;
use bytes::Bytes;
use http::Uri;
use serde::Deserialize;
use serde::Serialize;
use std::borrow::Cow;
use std::cell::RefCell;
use std::convert::TryFrom;
use std::fmt;
use std::net::ToSocketAddrs;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::Arc;
use tokio_rustls::rustls::RootCertStore;

pub trait WebTransportPermissions {
  fn check_net_url(
    &mut self,
    _url: &url::Url,
    _api_name: &str,
  ) -> Result<(), AnyError>;
}

pub const ALPN_HTTP3: &[&[u8]] = &[b"h3"];

#[derive(Clone)]
pub struct WebTransportRootStore(pub Option<RootCertStore>);

#[derive(Clone)]
pub struct WebTransportUserAgent(pub String);

pub struct WebTransportStreamResource {
  connection: AsyncRefCell<quinn::Connection>,
  send_stream: AsyncRefCell<quinn::SendStream>,
  recv_stream: AsyncRefCell<quinn::RecvStream>,
  pub cancel: CancelHandle,
}

impl WebTransportStreamResource {
  async fn send_datagram(self: &Rc<Self>, buf: &[u8]) -> Result<(), AnyError> {
    let res = {
      let connection = RcRef::map(self, |r| &r.connection)
      .borrow()
      .await;

      println!("send datagram: {:?}", buf);

      connection.send_datagram(Bytes::from(buf.to_vec()))
    };

    match res {
      Ok(_) => Ok(()),
      Err(err) => Err(err.into()),
    }
  }

  async fn read_datagram(
    self: &Rc<Self>,
    cancel: RcRef<CancelHandle>,
  ) -> Result<Vec<u8>, AnyError> {
    let connection = RcRef::map(self, |r| &r.connection)
      .borrow()
      .await;

    println!("read datagram");

    let chunk = connection.read_datagram().or_cancel(cancel).await?.map_err(AnyError::from)?;

    Ok(chunk.to_vec())
  }

  async fn abort(self: &Rc<Self>) {
    let connection = RcRef::map(self, |r| &r.connection)
      .borrow()
      .await;

    connection.close(0u32.into(), &[]);
  }

}

impl Resource for WebTransportStreamResource {
  fn name(&self) -> Cow<str> {
    "webTransportConnection".into()
  }
}

/// `UnsafelyIgnoreCertificateErrors` is a wrapper struct so it can be placed inside `GothamState`;
/// using type alias for a `Option<Vec<String>>` could work, but there's a high chance
/// that there might be another type alias pointing to a `Option<Vec<String>>`, which
/// would override previously used alias.
pub struct UnsafelyIgnoreCertificateErrors(Option<Vec<String>>);

pub struct WebTransportCancelResource(Rc<CancelHandle>);

impl Resource for WebTransportCancelResource {
  fn name(&self) -> Cow<str> {
    "webTransportCancel".into()
  }

  fn close(self: Rc<Self>) {
    self.0.cancel()
  }
}

pub struct Unstable(pub bool);

fn check_unstable(state: &OpState, api_name: &str) {
  let unstable = state.borrow::<Unstable>();

  if !unstable.0 {
    eprintln!(
      "Unstable API '{}'. The --unstable flag must be provided.",
      api_name
    );
    std::process::exit(70);
  }
}

pub fn check_unstable2(state: &Rc<RefCell<OpState>>, api_name: &str) {
  let state = state.borrow();
  check_unstable(&state, api_name)
}

// This op is needed because creating a WebTransport instance in JavaScript is a sync
// operation and should throw error when permissions are not fulfilled,
// but actual op that connects WS is async.
#[op]
pub fn op_wt_check_permission_and_cancel_handle<P>(
  state: &mut OpState,
  api_name: String,
  url: String,
  cancel_handle: bool,
) -> Result<Option<ResourceId>, AnyError>
where
P: WebTransportPermissions + 'static,
{
  state
    .borrow_mut::<P>()
    .check_net_url(&url::Url::parse(&url)?, &api_name)?;

  if cancel_handle {
    let rid = state
      .resource_table
      .add(WebTransportCancelResource(CancelHandle::new_rc()));
    Ok(Some(rid))
  } else {
    Ok(None)
  }
}

#[derive(Deserialize)]
pub struct WebTransportCertificateFingerprint {
  algorithm: String,
  fingerprint: String,
}

#[derive(Serialize)]
pub struct CreateResponse {
  rid: ResourceId,
}

#[op]
pub async fn op_wt_create<P>(
  state: Rc<RefCell<OpState>>,
  api_name: String,
  url: String,
  fingerprints: Vec<WebTransportCertificateFingerprint>,
) -> Result<CreateResponse, AnyError>
where
  P: WebTransportPermissions + 'static,
{
  check_unstable2(&state, "WebTransport#construct");

  {
    let mut s = state.borrow_mut();
    s.borrow_mut::<P>()
      .check_net_url(&url::Url::parse(&url)?, &api_name)
      .expect(
        "Permission check should have been done in op_wt_check_permission",
      );
  }

  let uri: Uri = url.parse()?;
  let domain = &uri.host().unwrap().to_string();
  let port = &uri.port_u16().unwrap_or(443);

  let unsafely_ignore_certificate_errors = state
    .borrow()
    .try_borrow::<UnsafelyIgnoreCertificateErrors>()
    .and_then(|it| it.0.clone());
  let root_cert_store = state.borrow().borrow::<WebTransportRootStore>().0.clone();

  let mut tls_config = create_client_config(
    root_cert_store,
    vec![],
    unsafely_ignore_certificate_errors,
    None,
  )?;
  tls_config.alpn_protocols = ALPN_HTTP3.iter().map(|&x| x.into()).collect();

  let addr = format!("{}:{}", domain, port)
    .to_socket_addrs()?
    .next()
    .unwrap();

  let mut transport_config = quinn::TransportConfig::default();
  transport_config.max_idle_timeout(Some(quinn::VarInt::from_u32(30_000).into()));
  transport_config.keep_alive_interval(Some(std::time::Duration::new(1, 0)));

  let mut client_config = quinn::ClientConfig::new(Arc::new(tls_config));
  client_config.transport_config(Arc::new(transport_config));

  let mut endpoint = quinn::Endpoint::client("[::]:0".parse().unwrap())?;
  endpoint.set_default_client_config(client_config);

  let connection = endpoint
    .connect(addr, uri.host().unwrap())?
    .await?;

  let (send_stream, recv_stream) = connection
    .open_bi()
    .await?;

  let resource = WebTransportStreamResource {
    connection: AsyncRefCell::new(connection.clone()),
    send_stream: AsyncRefCell::new(send_stream),
    recv_stream: AsyncRefCell::new(recv_stream),
    cancel: Default::default(),
  };
  let mut state = state.borrow_mut();
  let rid = state.resource_table.add(resource);

  Ok(CreateResponse { rid })
}

#[op]
pub async fn op_wt_send(
  state: Rc<RefCell<OpState>>,
  rid: ResourceId,
  value: ZeroCopyBuf,
) -> Result<(), AnyError> {
  let resource = state
    .borrow_mut()
    .resource_table
    .get::<WebTransportStreamResource>(rid)?;
  resource.send_datagram(&value).await?;
  Ok(())
}

#[derive(Serialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum NextEventResponse {
  Binary(ZeroCopyBuf),
  Close { code: u16, reason: String },
  Error(String),
  Closed,
}

#[op]
pub async fn op_wt_next_event(
  state: Rc<RefCell<OpState>>,
  rid: ResourceId,
) -> Result<NextEventResponse, AnyError> {
  let resource = state
    .borrow_mut()
    .resource_table
    .get::<WebTransportStreamResource>(rid)?;

  let cancel = RcRef::map(&resource, |r| &r.cancel);
  let res = match resource.read_datagram(cancel).await {
    Ok(data) => NextEventResponse::Binary(data.into()),
    Err(err) => NextEventResponse::Error(err.to_string())
  };

  Ok(res)
}

pub fn init<P: WebTransportPermissions + 'static>(
  unstable: bool,
  user_agent: String,
  root_cert_store: Option<RootCertStore>,
  unsafely_ignore_certificate_errors: Option<Vec<String>>,
) -> Extension {
  Extension::builder()
    .js(include_js_files!(
      prefix "deno:ext/webtransport",
      "01_webtransport.js",
      "02_idl_types.js",
    ))
    .ops(vec![
      op_wt_check_permission_and_cancel_handle::decl::<P>(),
      op_wt_create::decl::<P>(),
      op_wt_send::decl(),
      op_wt_next_event::decl(),
    ])
    .state(move |state| {
      state.put(Unstable(unstable));
      state.put::<WebTransportUserAgent>(WebTransportUserAgent(user_agent.clone()));
      state.put(UnsafelyIgnoreCertificateErrors(
        unsafely_ignore_certificate_errors.clone(),
      ));
      state.put::<WebTransportRootStore>(WebTransportRootStore(root_cert_store.clone()));
      Ok(())
    })
    .build()
}

pub fn get_declaration() -> PathBuf {
  PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("lib.deno_webtransport.d.ts")
}

#[derive(Debug)]
pub struct WebTransportError {
  pub msg: String,
}

impl WebTransportError {
  pub fn new(msg: &str) -> Self {
    WebTransportError {
      msg: msg.to_string(),
    }
  }
}

impl fmt::Display for WebTransportError {
  fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
    f.pad(&self.msg)
  }
}

impl std::error::Error for WebTransportError {}

pub fn get_error_class_name(e: &AnyError) -> Option<&'static str> {
  e.downcast_ref::<WebTransportError>()
    .map(|_| "WebTransportError")
}
