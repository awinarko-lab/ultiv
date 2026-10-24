import { Ping } from "@ultiv/contracts";

export default function App() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <h1>ultiv</h1>
      <p>Effect-first, AI-native. Contract v{Ping.def.version} ready.</p>
    </main>
  );
}
