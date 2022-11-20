// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
"use strict";

/// <reference path="../../core/internal.d.ts" />

((window) => {
  const core = window.Deno.core;
  const ops = core.ops;
  const { URL } = window.__bootstrap.url;
  const webidl = window.__bootstrap.webidl;
  const { DOMException } = window.__bootstrap.domException;
  const {
    ArrayPrototypeFilter,
    ArrayPrototypeMap,
    ArrayPrototypeSome,
    ErrorPrototypeToString,
    ObjectDefineProperties,
    ObjectPrototypeIsPrototypeOf,
    PromisePrototypeCatch,
    PromisePrototypeThen,
    String,
    StringPrototypeEndsWith,
    Symbol,
    SymbolFor,
    SymbolIterator,
    SymbolToStringTag,
    Uint8ArrayPrototype,
  } = window.__bootstrap.primordials;
  const {
    Deferred,
    writableStreamClose,
  } = window.__bootstrap.streams;

  const MAX_DATAGRAM_SIZE = 1024;
  const CLOSE_RESPONSE_TIMEOUT = 5000;

  const _rid = Symbol("[[rid]]");
  const _ready = Symbol("[[ready]]");
  const _closed = Symbol("[[closed]]");
  const _earlyClose = Symbol("[[earlyClose]]");
  const _closeSent = Symbol("[[closeSent]]");
  const _datagrams = Symbol("[[datagrams]]");

  class WebTransportDatagramDuplexStream {
    constructor() {
      webidl.illegalConstructor();
    }
  }

  const WebTransportDatagramDuplexStreamPrototype = WebTransportDatagramDuplexStream.prototype;

  class WebTransport {
    [webidl.brand] = webidl.brand;

    [_rid];

    #url;

    [_ready] = new Deferred();
    get ready() {
      webidl.assertBranded(this, WebTransportPrototype);
      return this[_ready].promise;
    }

    [_earlyClose] = false;
    [_closed] = new Deferred();
    [_closeSent] = new Deferred();
    get closed() {
      webidl.assertBranded(this, WebTransportPrototype);
      return this[_closed].promise;
    }

    /** @type {WebTransportDatagramDuplexStream} */
    [_datagrams];
    get datagrams() {
      return this[_datagrams];
    }

    /**
     * @param {string} url
     * @param {WebTransportOptions} options
     */
    constructor(url, options = {}) {
      const prefix = "Failed to construct 'WebTransport'";
      webidl.requiredArguments(arguments.length, 1, {
        prefix,
      });
      url = webidl.converters.USVString(url, {
        prefix,
        context: "Argument 1",
      });
      options = webidl.converters["WebTransportOptions"](
        options,
        {
          prefix,
          context: "Argument 2",
        },
      );

      /** @type {URL} */
      let webTransportURL;

      try {
        webTransportURL = new URL(url);
      } catch (e) {
        throw new DOMException(e.message, "SyntaxError");
      }

      if (webTransportURL.protocol !== "https:") {
        throw new DOMException(
          `The URL's scheme must be 'https'. '${webTransportURL.protocol}' is not allowed.`,
          "SyntaxError",
        );
      }

      if (webTransportURL.hash !== "" || StringPrototypeEndsWith(webTransportURL.href, "#")) {
        throw new DOMException(
          "Fragments are not allowed in a WebTransport URL.",
          "SyntaxError",
        );
      }

      this.#url = webTransportURL.href;

      ops.op_wt_check_permission_and_cancel_handle(
        "WebTransport.abort()",
        webTransportURL.href,
        false,
      );

      let fingerprints = [];
      if (options.serverCertificateHashes) {
        fingerprints = options.serverCertificateHashes.filter(function (hash) {
          return hash.algorithm && hash.value;
        }).map(function (hash) {
          // StringBuilder value_builder;
          // const uint8_t* data;
          // size_t size;
          // if (hash->value()->IsArrayBuffer()) {
          //   const auto* value = hash->value()->GetAsArrayBuffer();
          //   data = static_cast<const uint8_t*>(value->Data());
          //   size = value->ByteLength();
          // } else {
          //   DCHECK(hash->value()->IsArrayBufferView());
          //   const auto* value = hash->value()->GetAsArrayBufferView().Get();
          //   data = static_cast<const uint8_t*>(value->BaseAddress());
          //   size = value->byteLength();
          // }
          // for (size_t i = 0; i < size; ++i) {
          //   if (i > 0) {
          //     value_builder.Append(":");
          //   }
          //   value_builder.AppendFormat("%02X", data[i]);
          // }

          // The fingerprint of a certificate accompanied with the hash algorithm.
          // https://w3c.github.io/web-transport/#web-transport-configuration
          // https://www.w3.org/TR/webrtc/#dom-rtcdtlsfingerprint

          return {
            algorithm: hash.algorithm,
            fingerprint: ""
          }
        });
      }

      const writable = new WritableStream({
        write: async (chunk) => {
          if (
            ObjectPrototypeIsPrototypeOf(Uint8ArrayPrototype, chunk)
          ) {
            await core.opAsync("op_wt_send", this[_rid], chunk);
          } else {
            throw new TypeError(
              "Datagram is not an ArrayBuffer or ArrayBufferView type.",
            );
          }
        },
        close: async (reason) => {
          if (this[_ready].state === "pending") {
            this[_earlyClose] = true;
          } else if (this[_closed].state === "pending") {
            PromisePrototypeThen(
              core.opAsync("op_wt_close", this[_rid]),
              () => {
                setTimeout(() => {
                  this[_closeSent].resolve(new Date().getTime());
                }, 0);
              },
              (err) => {
                this[_rid] && core.tryClose(this[_rid]);
                this[_closed].reject(err);
              },
            );
          }

          try {
            this.close(reason?.code !== undefined ? reason : {});
          } catch (_) {
            this.close();
          }
          await this.closed;
        },
        abort: async (reason) => {
          try {
            this.close(reason?.code !== undefined ? reason : {});
          } catch (_) {
            this.close();
          }
          await this.closed;
        },
      });
      const pull = async (controller) => {
        if (this[_ready].state === "pending") {
          return;
        }

        const { kind, value } = await core.opAsync(
          "op_wt_next_event",
          this[_rid],
        );

        console.log('pull result:', kind, value)

        switch (kind) {
          case "binary": {
            controller.enqueue(value);
            break;
          }
          case "closed":
          case "close": {
            this[_closed].resolve(value);
            core.tryClose(this[_rid]);
            break;
          }
          case "error": {
            const err = new Error(value);
            this[_closed].reject(err);
            controller.error(err);
            core.tryClose(this[_rid]);
            break;
          }
        }

        if (
          this[_closeSent].state === "fulfilled" &&
          this[_closed].state === "pending"
        ) {
          if (
            new Date().getTime() - await this[_closeSent].promise <=
              CLOSE_RESPONSE_TIMEOUT
          ) {
            return pull(controller);
          }

          this[_closed].resolve(value);
          core.tryClose(this[_rid]);
        }
      };
      const readable = new ReadableStream({
        start: (controller) => {
          PromisePrototypeThen(this.closed, () => {
            try {
              controller.close();
            } catch (_) {
              // needed to ignore warnings & assertions
            }
            try {
              PromisePrototypeCatch(
                writableStreamClose(writable),
                () => {},
              );
            } catch (_) {
              // needed to ignore warnings & assertions
            }
          });

          PromisePrototypeThen(this[_closeSent].promise, () => {
            if (this[_closed].state === "pending") {
              return pull(controller);
            }
          });
        },
        pull,
        cancel: async (reason) => {
          try {
            this.close(reason?.code !== undefined ? reason : {});
          } catch (_) {
            this.close();
          }
          await this.closed;
        },
      });

      const webTransportDatagramDuplexStream =
        webidl.createBranded(WebTransportDatagramDuplexStream);

      ObjectDefineProperties(webTransportDatagramDuplexStream, {
        incomingHighWaterMark: {
          get() {
            webidl.assertBranded(this, WebTransportDatagramDuplexStreamPrototype);
            return 1;
          },
          configurable: true,
          enumerable: true,
        },
        incomingMaxAge: {
          get() {
            webidl.assertBranded(this, WebTransportDatagramDuplexStreamPrototype);
            return null;
          },
          configurable: true,
          enumerable: true,
        },
        maxDatagramSize: {
          get() {
            webidl.assertBranded(this, WebTransportDatagramDuplexStreamPrototype);
            return MAX_DATAGRAM_SIZE;
          },
          configurable: true,
          enumerable: true,
        },
        outgoingHighWaterMark: {
          get() {
            webidl.assertBranded(this, WebTransportDatagramDuplexStreamPrototype);
            return 1;
          },
          configurable: true,
          enumerable: true,
        },
        outgoingMaxAge: {
          get() {
            webidl.assertBranded(this, WebTransportDatagramDuplexStreamPrototype);
            return null;
          },
          configurable: true,
          enumerable: true,
        },
        readable: {
          get() {
            webidl.assertBranded(this, WebTransportDatagramDuplexStreamPrototype);
            return readable;
          },
          configurable: true,
          enumerable: true,
        },
        writable: {
          get() {
            webidl.assertBranded(this, WebTransportDatagramDuplexStreamPrototype);
            return writable;
          },
          configurable: true,
          enumerable: true,
        },
        [SymbolToStringTag]: {
          value: "WebTransportDatagramDuplexStream",
          configurable: true,
        },
        [SymbolFor("Deno.privateCustomInspect")]: {
          value: function (inspect) {
            const object = {
              incomingHighWaterMark: this.incomingHighWaterMark,
              incomingMaxAge: this.incomingMaxAge,
              maxDatagramSize: this.maxDatagramSize,
              outgoingHighWaterMark: this.outgoingHighWaterMark,
              outgoingMaxAge: this.outgoingMaxAge,
              readable: this.readable,
              writable: this.writable,
            };
            return `${this.constructor.name} ${inspect(object)}`;
          },
        },
      });

      this[_datagrams] = webTransportDatagramDuplexStream;

      PromisePrototypeThen(
        core.opAsync(
          "op_wt_create",
          "new WebTransport()",
          webTransportURL.href,
          fingerprints,
        ),
        (create) => {
          if (this[_earlyClose]) {
            PromisePrototypeThen(
              core.opAsync("op_ws_close", create.rid),
              () => {
                PromisePrototypeThen(
                  (async () => {
                    while (true) {
                      const { kind } = await core.opAsync(
                        "op_ws_next_event",
                        create.rid,
                      );

                      if (kind === "close") {
                        break;
                      }
                    }
                  })(),
                  () => {
                    const err = new DOMException(
                      "Closed while connecting",
                      "NetworkError",
                    );
                    this[_ready].reject(err);
                    this[_closed].reject(err);
                  },
                );
              },
              () => {
                const err = new DOMException(
                  "Closed while connecting",
                  "NetworkError",
                );
                this[_ready].reject(err);
                this[_closed].reject(err);
              },
            );
          } else {
            this[_rid] = create.rid;
            this[_ready].resolve();
          }
        },
        () => {
          const err = new DOMException(
            "Closed while connecting",
            "NetworkError",
          );
          this[_ready].reject(err);
          this[_closed].reject(err);
        },
      );
    }

    [SymbolFor("Deno.customInspect")](inspect) {
      return `${this.constructor.name} ${
        inspect({
          url: this.#url,
        })
      }`;
    }
  }

  const WebTransportPrototype = WebTransport.prototype;

  window.__bootstrap.webTransport = {
    WebTransportDatagramDuplexStream,
    WebTransport,
    _rid,
    _ready,
    _closed,
  };
})(this);
