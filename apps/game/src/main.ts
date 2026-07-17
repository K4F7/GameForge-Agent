const host = document.querySelector<HTMLElement>("#game");
if (host === null) throw new Error("Game host is missing.");
host.dataset.state = "loading";

import("./game.js").then(() => {
  host.dataset.state = "ready";
}).catch((error: unknown) => {
  host.dataset.state = "failed";
  host.textContent = error instanceof Error ? `Game failed to load: ${error.message}` : "Game failed to load.";
});
