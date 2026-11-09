import test from "node:test";
import assert from "node:assert/strict";
import { createConveyorSender } from "../js/conveyor.js";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitUntil(predicate) {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) return;
    await delay(10);
  }
  throw new Error("Timed out waiting for command");
}

test("requires neutral before movement and renews commands in order", async () => {
  const commands = [];
  const fetchImpl = async (url, options) => {
    if (url.endsWith("/conveyor/lease")) {
      return { ok: true, json: async () => ({ controller_session: "boot", conveyor_sequence: 9, lease: 100 }) };
    }
    const body = JSON.parse(options.body);
    commands.push(body);
    return { ok: true, json: async () => ({ accepted: true, controller_session: "boot", conveyor_sequence: body.sequence, lease: body.lease + 1 }) };
  };
  const sender = createConveyorSender({ servoUrl: "http://controller/servo", fetchImpl });
  try {
    sender.setDirection(1);
    await delay(110);
    assert.equal(commands.length, 0);
    sender.setDirection(0);
    await waitUntil(() => commands.length === 1);
    sender.setDirection(1);
    await waitUntil(() => commands.length === 2);
    sender.setDirection(null);
    await delay(150);
    sender.setDirection(1);
    await delay(150);
    assert.deepEqual(commands.map((command) => command.direction), [0, 1]);
    assert.deepEqual(commands.map((command) => command.sequence), [10, 11]);
  } finally {
    sender.stop();
  }
});

test("does not send a command when input expires during lease acquisition", async () => {
  let resolveLease;
  const commands = [];
  const fetchImpl = async (url, options) => {
    if (url.endsWith("/conveyor/lease")) {
      return new Promise((resolve) => {
        resolveLease = () => resolve({ ok: true, json: async () => ({ controller_session: "boot", conveyor_sequence: 0, lease: 100 }) });
      });
    }
    commands.push(JSON.parse(options.body));
    throw new Error("Unexpected conveyor command");
  };
  const sender = createConveyorSender({ servoUrl: "http://controller/servo", fetchImpl });
  try {
    sender.setDirection(0);
    await waitUntil(() => Boolean(resolveLease));
    await delay(210);
    resolveLease();
    await delay(50);
    assert.deepEqual(commands, []);
  } finally {
    sender.stop();
  }
});

test("a late neutral response cannot arm a reconnected held stick", async () => {
  const commands = [];
  let resolveNeutral;
  const fetchImpl = async (url, options) => {
    if (url.endsWith("/conveyor/lease")) {
      return { ok: true, json: async () => ({ controller_session: "boot", conveyor_sequence: 0, lease: 100 }) };
    }
    const body = JSON.parse(options.body);
    commands.push(body);
    return new Promise((resolve) => {
      resolveNeutral = () => resolve({ ok: true, json: async () => ({ accepted: true, controller_session: "boot", conveyor_sequence: body.sequence, lease: 101 }) });
    });
  };
  const sender = createConveyorSender({ servoUrl: "http://controller/servo", fetchImpl });
  try {
    sender.setDirection(0);
    await waitUntil(() => commands.length === 1);
    sender.setDirection(null);
    sender.setDirection(1);
    resolveNeutral();
    await delay(250);
    assert.deepEqual(commands.map((command) => command.direction), [0]);
  } finally {
    sender.stop();
  }
});

test("stops renewing a held direction when XR frames stop", async () => {
  const commands = [];
  const fetchImpl = async (url, options) => {
    if (url.endsWith("/conveyor/lease")) {
      return { ok: true, json: async () => ({ controller_session: "boot", conveyor_sequence: 0, lease: 10 }) };
    }
    const body = JSON.parse(options.body);
    commands.push(body);
    return { ok: true, json: async () => ({ accepted: true, controller_session: "boot", conveyor_sequence: body.sequence, lease: body.lease + 1 }) };
  };
  const sender = createConveyorSender({ servoUrl: "http://controller/servo", fetchImpl });
  try {
    sender.setDirection(0);
    await waitUntil(() => commands.length > 0);
    sender.setDirection(1);
    await waitUntil(() => commands.some((command) => command.direction === 1));
    await delay(350);
    const count = commands.length;
    await delay(250);
    assert.equal(commands.length, count);
    sender.setDirection(1);
    await delay(150);
    assert.equal(commands.length, count);
  } finally {
    sender.stop();
  }
});

test("a resumed held frame cannot erase a stale input gap", async () => {
  let clock = 0;
  const commands = [];
  const fetchImpl = async (url, options) => {
    if (url.endsWith("/conveyor/lease")) {
      return { ok: true, json: async () => ({ controller_session: "boot", conveyor_sequence: 0, lease: 10 }) };
    }
    const body = JSON.parse(options.body);
    commands.push(body);
    return { ok: true, json: async () => ({ accepted: true, controller_session: "boot", conveyor_sequence: body.sequence, lease: body.lease + 1 }) };
  };
  const sender = createConveyorSender({ servoUrl: "http://controller/servo", fetchImpl, now: () => clock });
  try {
    sender.setDirection(0);
    await waitUntil(() => commands.length === 1);
    clock = 201;
    sender.setDirection(1);
    await delay(150);
    assert.deepEqual(commands.map((command) => command.direction), [0]);
  } finally {
    sender.stop();
  }
});
