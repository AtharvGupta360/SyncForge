/**
 * @syncforge/client
 *
 * The web client. For now it holds only the *pure* half -- the Monaco
 * anti-corruption boundary -- so it compiles with nothing browser-specific in
 * scope and its logic is unit-testable without a DOM. The Monaco/DOM shell
 * (editor mounting, event wiring, Socket.IO connection) arrives in the UI phase
 * and will live alongside this, never inside it.
 */

export { changesToOps } from "./boundary.js";
export type { EditorChange } from "./boundary.js";

export { ClientSession } from "./session.js";
