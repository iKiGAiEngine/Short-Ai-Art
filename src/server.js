import { createServer } from "./api.js";
import { dataRoot, ensureStore } from "./store.js";

const port = Number(process.env.PORT || 4173);

await ensureStore();

createServer().listen(port, () => {
  console.log(`Short AI Art running at http://localhost:${port}`);
  console.log(`Project data: ${dataRoot()}`);
  if (process.env.HIGGSFIELD_ENABLED === "true") {
    console.warn("HIGGSFIELD_ENABLED=true — paid generation is unlocked for this process.");
  }
});
