import { redirect } from "next/navigation";

// The site is the Star Atlas now — the root sends you straight into the sky.
export default function Home() {
  redirect("/network/ngsl");
}
