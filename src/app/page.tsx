import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div>
      <p className="font-bold text-rose-500">
        Hello, world! This is a simple Next.js application.
        <Button variant="destructive">Clickme!</Button>
      </p>
    </div>
  );
}
