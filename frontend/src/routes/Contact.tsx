import { LegalLayout } from "./LegalLayout";

export function Contact() {
  return (
    <LegalLayout title="Contact" updated="2026-09-15">
      <p>
        AlgoTheseus is a no-account, tracker-free tool — the fastest way to
        reach us is below.
      </p>
      <h2>Report abuse or a security issue</h2>
      <p>
        If you spot sandbox abuse, malware, or a vulnerability, please include
        the date/time (UTC), a short description, and — for bad runs — the
        offending source only if it is safe to share. Never send passwords or
        secrets.
      </p>
      <h2>General inquiries</h2>
      <p>
        For bugs, trace-accuracy questions, or requests to remove content from
        operational logs (IP/error logs kept briefly for security and
        debugging), write to the project maintainers via the repository’s issue
        tracker or the support address published there. We aim to reply within
        a few business days.
      </p>
      <h2>What not to send</h2>
      <p>
        Please do not submit private keys, credentials, or personal data —
        everything you run is executed ephemerally in a shared sandbox with
        10s/128MB limits and should be treated as non-confidential.
      </p>
      <h2>Contribute</h2>
      <p>
        AlgoTheseus is open source — issues and pull requests are welcome.
        Star the project, file a bug, or pick up an open issue:{" "}
        <a href="https://github.com/BlackPool25/AlgoTheseus">
          github.com/BlackPool25/AlgoTheseus
        </a>{" "}
        ·{" "}
        <a href="https://github.com/BlackPool25/AlgoTheseus/issues">
          open issues
        </a>
        .
      </p>
    </LegalLayout>
  );
}
