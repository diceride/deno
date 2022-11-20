// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.

// @ts-check
/// <reference path="../web/internal.d.ts" />

"use strict";

((window) => {
  const webidl = window.__bootstrap.webidl;
  const { SymbolIterator, TypeError } = window.__bootstrap.primordials;

  // This needs to be initialized after all of the base classes are implemented,
  // otherwise their converters might not be available yet.

  // DICTIONARY: WebTransportHash
  const dictMembersWebTransportHash = [
    {
      key: "algorithm",
      converter: webidl.converters["DOMString"],
      required: true,
    },
    {
      key: "value",
      converter: webidl.converters["BufferSource"],
      required: true,
    },
  ];
  webidl.converters["WebTransportHash"] = webidl.createDictionaryConverter(
    "WebTransportHash",
    dictMembersWebTransportHash,
  );
  webidl.converters["sequence<WebTransportHash>"] = webidl
    .createSequenceConverter(
      webidl.converters.WebTransportHash,
    );

  // DICTIONARY: WebTransportOptions
  const dictMembersWebTransportOptions = [
    {
      key: "allowPooling",
      converter: webidl.converters["boolean"],
      defaultValue: false,
    },
    {
      key: "requireUnreliable",
      converter: webidl.converters["boolean"],
      defaultValue: false,
    },
    {
      key: "serverCertificateHashes",
      converter: webidl.converters["sequence<WebTransportHash>"],
      get defaultValue() {
        return [];
      },
    },
  ];
  webidl.converters["WebTransportOptions"] = webidl.createDictionaryConverter(
    "WebTransportOptions",
    dictMembersWebTransportOptions,
  );

  // ENUM: WebTransportReliabilityMode
  webidl.converters["WebTransportReliabilityMode"] = webidl.createEnumConverter(
    "WebTransportReliabilityMode",
    [
      "pending",
      "reliable-only",
      "supports-unreliable",
    ],
  );
})(this);
