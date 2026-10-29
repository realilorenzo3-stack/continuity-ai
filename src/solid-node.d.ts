// Il runtime Node usa la build reattiva di Solid, non l'entrypoint SSR.
declare module "solid-js/dist/solid.js" {
  export { createSignal } from "solid-js";
}
