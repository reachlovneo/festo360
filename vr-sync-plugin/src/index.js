// Entry point loaded by tours as:
//   <script type="module" src=".../vr-sync-plugin/src/index.js"></script>
//   <script type="module">
//     import { VRSync } from ".../vr-sync-plugin/src/index.js"; // or use window.VRSync
//     VRSync.init({ firebaseConfig: {...} });
//   </script>
// type="module" is required - FirebaseSync.js imports the Firebase SDK as ES modules.
import { VRSync as VRSyncClass } from "./VRSync.js";

export const VRSync = new VRSyncClass();
window.VRSync = VRSync;
