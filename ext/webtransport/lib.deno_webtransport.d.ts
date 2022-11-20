// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.

// deno-lint-ignore-file

/// <reference no-default-lib="true" />
/// <reference lib="esnext" />

/** @category WebTransport */
declare class WebTransportDatagramDuplexStream {
    readonly readable: ReadableStream;
    readonly writable: WritableStream;
    readonly maxDatagramSize: number;
    incomingMaxAge: number;
    outgoingMaxAge: number;
    incomingHighWaterMark: number;
    outgoingHighWaterMark: number;
}

/**
 * @tags allow-net
 * @category WebTransport
 */
 declare class WebTransport {
    constructor(url: string, options?: WebTransportOptions);
    getStats(): Promise<WebTransportStats>;
    readonly ready: Promise<undefined>;
    readonly reliability: WebTransportReliabilityMode;
    readonly closed: Promise<WebTransportCloseInfo>;
    close(closeInfo?: WebTransportCloseInfo): void;
    readonly datagrams: WebTransportDatagramDuplexStream;
    createBidirectionalStream(): Promise<WebTransportBidirectionalStream>;
    readonly incomingBidirectionalStreams: ReadableStream;
    createUnidirectionalStream(): Promise<WebTransportSendStream>;
    readonly incomingUnidirectionalStreams: ReadableStream;
}

/** @category WebTransport */
declare enum WebTransportReliabilityMode {
    Pending = "pending",
    ReliableOnly = "reliable-only",
    SupportsUnreliable = "supports-unreliable"
}

/** @category WebTransport */
interface WebTransportHash {
    algorithm?: string;
    value?: BufferSource;
}

/** @category WebTransport */
interface WebTransportOptions {
    allowPooling?: boolean;
    requireUnreliable?: boolean;
    serverCertificateHashes?: Array<WebTransportHash>;
}

/** @category WebTransport */
interface WebTransportCloseInfo {
    closeCode?: number;
    reason?: string;
}

/** @category WebTransport */
interface WebTransportStats {
    timestamp?: any;
    bytesSent?: number;
    packetsSent?: number;
    packetsLost?: number;
    numOutgoingStreamsCreated?: number;
    numIncomingStreamsCreated?: number;
    bytesReceived?: number;
    packetsReceived?: number;
    smoothedRtt?: any;
    rttVariation?: any;
    minRtt?: any;
    datagrams?: WebTransportDatagramStats;
}

/** @category WebTransport */
interface WebTransportDatagramStats {
    timestamp?: any;
    expiredOutgoing?: number;
    droppedIncoming?: number;
    lostOutgoing?: number;
}

/** @category WebTransport */
interface WebTransportSendStream extends WritableStream {
    getStats(): Promise<WebTransportSendStreamStats>;
}

/** @category WebTransport */
interface WebTransportSendStreamStats {
    timestamp?: any;
    bytesWritten?: number;
    bytesSent?: number;
    bytesAcknowledged?: number;
}

/** @category WebTransport */
interface WebTransportReceiveStream extends ReadableStream {
    getStats(): Promise<WebTransportReceiveStreamStats>;
}

/** @category WebTransport */
interface WebTransportReceiveStreamStats {
    timestamp?: any;
    bytesReceived?: number;
    bytesRead?: number;
}

/** @category WebTransport */
declare class WebTransportBidirectionalStream {
    readonly readable: ReadableStream;
    readonly writable: WritableStream;
}

/** @category WebTransport */
declare class WebTransportError extends DOMException {
    constructor(init?: WebTransportErrorInit);
    readonly source: WebTransportErrorSource;
    readonly streamErrorCode: number;
}

/** @category WebTransport */
interface WebTransportErrorInit {
    streamErrorCode?: number;
    message?: string;
}

/** @category WebTransport */
declare enum WebTransportErrorSource {
    Stream = "stream",
    Session = "session"
}
