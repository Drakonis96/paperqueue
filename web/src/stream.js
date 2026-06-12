// Holds a single live WebSocket to Zotero's streaming API so changes anywhere
// in the library — another device, the Zotero apps, zotero.org, or another
// PaperQueue client — surface within ~a second. Mirrors the app's
// ZoteroStreamClient. The server keeps ONE connection and fans the "library
// changed" signal out to every connected browser over SSE.

import { EventEmitter } from "node:events";
import WebSocket from "ws";

const BASE_RECONNECT_MS = 10_000;
const MAX_RECONNECT_MS = 120_000;

export class ZoteroStream extends EventEmitter {
  constructor({ apiKey, userId, url }) {
    super();
    this.apiKey = apiKey;
    this.topic = `/users/${userId}`;
    this.url = url || "wss://stream.zotero.org";
    this.ws = null;
    this.running = false;
    this.reconnectDelay = BASE_RECONNECT_MS;
    this.reconnectTimer = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.reconnectDelay = BASE_RECONNECT_MS;
    this._connect();
  }

  stop() {
    this.running = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }

  _connect() {
    if (!this.running) return;
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this._scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.on("message", (raw) => this._handle(raw));
    ws.on("close", () => this._scheduleReconnect());
    ws.on("error", () => {
      // 'close' fires after 'error'; reconnect is handled there.
    });
  }

  _handle(raw) {
    let obj;
    try {
      obj = JSON.parse(raw.toString());
    } catch {
      return;
    }
    switch (obj.event) {
      case "connected":
        if (typeof obj.retry === "number") {
          this.reconnectDelay = obj.retry;
        }
        this._subscribe();
        break;
      case "topicUpdated": {
        const version =
          typeof obj.version === "number" ? obj.version : -1;
        this.emit("changed", version);
        break;
      }
      default:
        // subscriptionsCreated / topicAdded / topicRemoved — nothing to do.
        break;
    }
  }

  _subscribe() {
    const payload = {
      action: "createSubscriptions",
      subscriptions: [{ apiKey: this.apiKey, topics: [this.topic] }],
    };
    try {
      this.ws?.send(JSON.stringify(payload), (err) => {
        if (!err) this.reconnectDelay = BASE_RECONNECT_MS;
      });
    } catch {
      /* ignore — reconnect handles a dead socket */
    }
  }

  _scheduleReconnect() {
    this.ws = null;
    if (!this.running) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, MAX_RECONNECT_MS);
    this.reconnectTimer = setTimeout(() => this._connect(), delay);
  }
}
