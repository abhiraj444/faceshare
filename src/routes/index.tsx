import { createFileRoute } from "@tanstack/react-router";
import { FaceParticlesApp } from "@/components/face-particles/app";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return <FaceParticlesApp />;
}
