// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
import {
  assert,
  assertEquals,
  assertThrows,
  fail,
} from "../../../../test_util/std/testing/asserts.ts";
import { deferred } from "../../../../test_util/std/async/deferred.ts";

Deno.test("invalid scheme", () => {
  assertThrows(() => new WebTransport("foo://localhost:4245"));
});

Deno.test("fragment", () => {
  assertThrows(() => new WebTransport("https://localhost:4245/#"));
  assertThrows(() => new WebTransport("https://localhost:4245/#foo"));
});

Deno.test("duplicate protocols", () => {
  assertThrows(() => new WebTransport("https://localhost:4245", ["foo", "foo"]));
});

Deno.test("invalid server", async () => {
  const promise = deferred();
  const wt = new WebTransport("https://localhost:2121");
  let err = false;
  wt.onerror = () => {
    err = true;
  };
  wt.onclose = () => {
    if (err) {
      promise.resolve();
    } else {
      fail();
    }
  };
  wt.onopen = () => fail();
  await promise;
});

Deno.test("connect & close", async () => {
  const promise = deferred();
  const wt = new WebTransport("https://localhost:4245");
  wt.onerror = () => fail();
  wt.onopen = () => {
    wt.close();
  };
  wt.onclose = () => {
    promise.resolve();
  };
  await promise;
});

Deno.test("connect & abort", async () => {
  const promise = deferred();
  const wt = new WebTransport("https://localhost:4245");
  wt.close();
  let err = false;
  wt.onerror = () => {
    err = true;
  };
  wt.onclose = () => {
    if (err) {
      promise.resolve();
    } else {
      fail();
    }
  };
  wt.onopen = () => fail();
  await promise;
});

Deno.test("connect & close custom valid code", async () => {
  const promise = deferred();
  const wt = new WebTransport("https://localhost:4245");
  wt.onerror = () => fail();
  wt.onopen = () => wt.close(1000);
  wt.onclose = () => {
    promise.resolve();
  };
  await promise;
});

Deno.test("connect & close custom invalid code", async () => {
  const promise = deferred();
  const wt = new WebTransport("https://localhost:4245");
  wt.onerror = () => fail();
  wt.onopen = () => {
    assertThrows(() => wt.close(1001));
    wt.close();
  };
  wt.onclose = () => {
    promise.resolve();
  };
  await promise;
});

Deno.test("connect & close custom valid reason", async () => {
  const promise = deferred();
  const wt = new WebTransport("https://localhost:4245");
  wt.onerror = () => fail();
  wt.onopen = () => wt.close(1000, "foo");
  wt.onclose = () => {
    promise.resolve();
  };
  await promise;
});

Deno.test("connect & close custom invalid reason", async () => {
  const promise = deferred();
  const wt = new WebTransport("https://localhost:4245");
  wt.onerror = () => fail();
  wt.onopen = () => {
    assertThrows(() => wt.close(1000, "".padEnd(124, "o")));
    wt.close();
  };
  wt.onclose = () => {
    promise.resolve();
  };
  await promise;
});

Deno.test("echo string", async () => {
  const promise = deferred();
  const wt = new WebTransport("https://localhost:4245");
  wt.onerror = () => fail();
  wt.onopen = () => wt.send("foo");
  wt.onmessage = (e) => {
    assertEquals(e.data, "foo");
    wt.close();
  };
  wt.onclose = () => {
    promise.resolve();
  };
  await promise;
});

Deno.test("echo string tls", async () => {
  const promise1 = deferred();
  const promise2 = deferred();
  const wt = new WebTransport("https://localhost:4243");
  wt.onerror = () => fail();
  wt.onopen = () => wt.send("foo");
  wt.onmessage = (e) => {
    assertEquals(e.data, "foo");
    wt.close();
    promise1.resolve();
  };
  wt.onclose = () => {
    promise2.resolve();
  };
  await promise1;
  await promise2;
});

Deno.test("WebTransport error", async () => {
  const promise1 = deferred();
  const wt = new WebTransport("https://localhost:4245");
  wt.onopen = () => fail();
  wt.onerror = (err) => {
    assert(err instanceof ErrorEvent);

    // Error message got changed because we don't use warp in test_util
    assertEquals(err.message, "UnexpectedEof: tls handshake eof");
    promise1.resolve();
  };
  await promise1;
});

Deno.test("echo blob with binaryType blob", async () => {
  const promise = deferred();
  const wt = new WebTransport("https://localhost:4245");
  const blob = new Blob(["foo"]);
  wt.onerror = () => fail();
  wt.onopen = () => wt.send(blob);
  wt.onmessage = (e) => {
    e.data.text().then((actual: string) => {
      blob.text().then((expected) => {
        assertEquals(actual, expected);
      });
    });
    wt.close();
  };
  wt.onclose = () => {
    promise.resolve();
  };
  await promise;
});

Deno.test("echo blob with binaryType arraybuffer", async () => {
  const promise = deferred();
  const wt = new WebTransport("https://localhost:4245");
  wt.binaryType = "arraybuffer";
  const blob = new Blob(["foo"]);
  wt.onerror = () => fail();
  wt.onopen = () => wt.send(blob);
  wt.onmessage = (e) => {
    blob.arrayBuffer().then((expected) => {
      assertEquals(e.data, expected);
    });
    wt.close();
  };
  wt.onclose = () => {
    promise.resolve();
  };
  await promise;
});

Deno.test("echo uint8array with binaryType blob", async () => {
  const promise = deferred();
  const wt = new WebTransport("https://localhost:4245");
  const uint = new Uint8Array([102, 111, 111]);
  wt.onerror = () => fail();
  wt.onopen = () => wt.send(uint);
  wt.onmessage = (e) => {
    e.data.arrayBuffer().then((actual: ArrayBuffer) => {
      assertEquals(actual, uint.buffer);
    });
    wt.close();
  };
  wt.onclose = () => {
    promise.resolve();
  };
  await promise;
});

Deno.test("echo uint8array with binaryType arraybuffer", async () => {
  const promise = deferred();
  const wt = new WebTransport("https://localhost:4245");
  wt.binaryType = "arraybuffer";
  const uint = new Uint8Array([102, 111, 111]);
  wt.onerror = () => fail();
  wt.onopen = () => wt.send(uint);
  wt.onmessage = (e) => {
    assertEquals(e.data, uint.buffer);
    wt.close();
  };
  wt.onclose = () => {
    promise.resolve();
  };
  await promise;
});

Deno.test("echo arraybuffer with binaryType blob", async () => {
  const promise = deferred();
  const wt = new WebTransport("https://localhost:4245");
  const buffer = new ArrayBuffer(3);
  wt.onerror = () => fail();
  wt.onopen = () => wt.send(buffer);
  wt.onmessage = (e) => {
    e.data.arrayBuffer().then((actual: ArrayBuffer) => {
      assertEquals(actual, buffer);
    });
    wt.close();
  };
  wt.onclose = () => {
    promise.resolve();
  };
  await promise;
});

Deno.test("echo arraybuffer with binaryType arraybuffer", async () => {
  const promise = deferred();
  const wt = new WebTransport("https://localhost:4245");
  wt.binaryType = "arraybuffer";
  const buffer = new ArrayBuffer(3);
  wt.onerror = () => fail();
  wt.onopen = () => wt.send(buffer);
  wt.onmessage = (e) => {
    assertEquals(e.data, buffer);
    wt.close();
  };
  wt.onclose = () => {
    promise.resolve();
  };
  await promise;
});

Deno.test("Event Handlers order", async () => {
  const promise = deferred();
  const wt = new WebTransport("https://localhost:4245");
  const arr: number[] = [];
  wt.onerror = () => fail();
  wt.addEventListener("message", () => arr.push(1));
  wt.onmessage = () => fail();
  wt.addEventListener("message", () => {
    arr.push(3);
    wt.close();
    assertEquals(arr, [1, 2, 3]);
  });
  wt.onmessage = () => arr.push(2);
  wt.onopen = () => wt.send("Echo");
  wt.onclose = () => {
    promise.resolve();
  };
  await promise;
});

Deno.test("Close without frame", async () => {
  const promise = deferred();
  const wt = new WebTransport("https://localhost:4244");
  wt.onerror = () => fail();
  wt.onclose = (e) => {
    assertEquals(e.code, 1005);
    promise.resolve();
  };
  await promise;
});
