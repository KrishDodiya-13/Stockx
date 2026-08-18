import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="gutter flex min-h-[100svh] flex-col justify-center">
      <p className="tabular eyebrow">404</p>
      <h1 className="mt-6 text-display-m">This page isn&rsquo;t on the tape.</h1>
      <p className="mt-6 max-w-md text-base text-ink-secondary">
        The screen you asked for doesn&rsquo;t exist, or hasn&rsquo;t been built yet.
      </p>
      <ButtonLink href="/" className="mt-10 self-start">
        Back to overview
      </ButtonLink>
    </main>
  );
}
