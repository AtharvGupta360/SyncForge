/**
 * The SyncForge editor page -- the shell that wires three things together:
 *
 *   Monaco (the editor)  <->  ClientSession (the tested brain)  <->  socket.io
 *
 * The rule from every prior phase still holds: no decisions live here. Local
 * edits are handed to `session.localEdit`; server messages are handed to the
 * matching `session.on*`; whatever those return is emitted. This file only
 * moves messages and reflects the session onto the DOM.
 *
 * Open two tabs at the same URL hash (e.g. #demo) to collaborate. Concurrent
 * typing is resynced rather than merged in this phase -- that is the transform
 * seam, filled in P13-16.
 */

import Editor, { type OnChange, type OnMount } from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

import { ClientSession, changesToOps } from "@syncforge/client";
import type {
  ClientMessage,
  Op,
  OpAckMessage,
  OpBroadcastMessage,
  OpRejectMessage,
  RoomSnapshotMessage,
} from "@syncforge/shared";

// The socket is a different origin than the Vite dev server; the server allows
// it via open CORS in dev.
const SERVER_URL = "http://localhost:3001";
const roomId = window.location.hash.slice(1) || "demo";

type MonacoEditor = Parameters<OnMount>[0];
type MonacoNamespace = Parameters<OnMount>[1];

export function App() {
  const [connected, setConnected] = useState(false);
  const [version, setVersion] = useState(0);
  const [members, setMembers] = useState<readonly string[]>([]);

  const sessionRef = useRef<ClientSession | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const editorRef = useRef<MonacoEditor | null>(null);
  const monacoRef = useRef<MonacoNamespace | null>(null);
  // True while WE are editing Monaco programmatically (applying a remote op).
  // The onChange handler checks this to avoid treating our own write as a fresh
  // local edit -- the echo/feedback loop that would otherwise never terminate.
  const applyingRemote = useRef(false);

  /**
   * Write text into Monaco without it counting as a local edit. Used for the
   * snapshot (full reset) and for each remote op (surgical edit).
   */
  function withRemoteApply(fn: () => void): void {
    applyingRemote.current = true;
    try {
      fn();
    } finally {
      applyingRemote.current = false;
    }
  }

  /** Apply a peer's op to Monaco, converting flat offsets back to positions --
   *  the reverse of the Phase 6 boundary. Surgical (not setValue) so the local
   *  cursor and scroll are preserved. */
  function applyRemoteOp(op: Op): void {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor?.getModel();
    if (!editor || !monaco || !model) return;

    withRemoteApply(() => {
      const start = model.getPositionAt(op.position);
      if (op.type === "insert") {
        const range = new monaco.Range(
          start.lineNumber,
          start.column,
          start.lineNumber,
          start.column,
        );
        model.applyEdits([{ range, text: op.text, forceMoveMarkers: true }]);
      } else {
        const end = model.getPositionAt(op.position + op.length);
        const range = new monaco.Range(
          start.lineNumber,
          start.column,
          end.lineNumber,
          end.column,
        );
        model.applyEdits([{ range, text: "" }]);
      }
    });
  }

  function resetEditor(content: string): void {
    const model = editorRef.current?.getModel();
    if (!model) return;
    withRemoteApply(() => model.setValue(content));
  }

  // Startup + shutdown. The effect opens the socket on mount and returns a
  // cleanup that closes it on unmount -- a process lifecycle in miniature.
  useEffect(() => {
    const session = new ClientSession(roomId);
    sessionRef.current = session;

    const socket = io(SERVER_URL, { transports: ["websocket"] });
    socketRef.current = socket;

    const send = (messages: ClientMessage[]): void => {
      for (const message of messages) socket.emit(message.kind, message);
    };

    socket.on("connect", () => {
      setConnected(true);
      send(session.join());
    });
    socket.on("disconnect", () => setConnected(false));

    socket.on("room:snapshot", (message: RoomSnapshotMessage) => {
      session.onSnapshot(message);
      resetEditor(message.content);
      setVersion(session.version);
      setMembers(message.members);
    });

    socket.on("op:ack", (message: OpAckMessage) => {
      send(session.onAck(message));
      setVersion(session.version);
    });

    socket.on("op:broadcast", (message: OpBroadcastMessage) => {
      // Only paint the op onto Monaco if the session accepted it cleanly. If it
      // resynced (we had local edits outstanding), a fresh snapshot is coming
      // and will reset the editor instead.
      const wasClean = !session.inFlight && session.bufferedCount === 0;
      const out = session.onBroadcast(message);
      send(out);
      if (wasClean && out.length === 0) applyRemoteOp(message.op);
      setVersion(session.version);
    });

    socket.on("op:reject", (message: OpRejectMessage) => {
      send(session.onReject(message));
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    // A snapshot may have arrived before Monaco mounted; seed from the session.
    withRemoteApply(() => editor.setValue(sessionRef.current?.document ?? ""));
  };

  const onChange: OnChange = (_value, event) => {
    if (applyingRemote.current) return; // ignore our own programmatic writes
    const session = sessionRef.current;
    const socket = socketRef.current;
    if (!session || !socket) return;

    // One editor event can yield several ops (replace = delete+insert, or
    // multi-cursor). Each gets its own id and flows through the session.
    for (const op of changesToOps(event.changes)) {
      const toSend = session.localEdit(crypto.randomUUID(), op);
      for (const message of toSend) socket.emit(message.kind, message);
    }
    setVersion(session.version);
  };

  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
        height: "100vh",
      }}
    >
      <header
        style={{
          padding: "8px 12px",
          background: "#1e1e1e",
          color: "#ddd",
          display: "flex",
          gap: 16,
          fontSize: 13,
        }}
      >
        <strong>SyncForge</strong>
        <span>room: {roomId}</span>
        <span>{connected ? "🟢 connected" : "🔴 offline"}</span>
        <span>version: {version}</span>
        <span>members: {members.length}</span>
      </header>
      <div style={{ flex: 1 }}>
        <Editor
          height="100%"
          defaultLanguage="typescript"
          theme="vs-dark"
          onMount={onMount}
          onChange={onChange}
          options={{ minimap: { enabled: false }, fontSize: 14 }}
        />
      </div>
    </div>
  );
}
