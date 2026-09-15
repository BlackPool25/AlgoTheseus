import { LegalLayout } from "./LegalLayout";

export function Privacy() {
  return (
    <LegalLayout title="Privacy Policy" updated="2026-09-15">
      <p>
        AlgoTheseus is a client-side C++ algorithm visualizer. There are no
        accounts, no sign-ups, and no analytics, cookies, or tracking of any
        kind.
      </p>
      <h2>What is transmitted and processed</h2>
      <p>
        When you press “Run”, the C++ source code you wrote and the stdin text
        you entered are transmitted to our execution backend, compiled, and
        executed ephemerally inside an isolated sandbox limited to roughly 10
        seconds of CPU time and 128&nbsp;MB of memory. Submitted code and its
        execution artifacts are discarded when the run finishes and are not
        retained.
      </p>
      <h2>Logs we keep</h2>
      <p>
        To keep the service stable and prevent abuse, our infrastructure may
        record minimal operational logs (such as IP address, timestamp, error
        messages, and resource usage) for a short retention period. These logs
        are used only for security, debugging, and rate-limiting, and are never
        sold or shared for advertising.
      </p>
      <h2>What we never collect</h2>
      <p>
        We do not create user profiles, set tracking cookies, run analytics
        beacons, or collect personal information beyond what is strictly needed
        to operate the sandbox. Your theme preference is stored only in your
        own browser’s local storage.
      </p>
      <h2>Contact</h2>
      <p>
        Questions about this policy: see our <a href="/contact">contact page</a>.
      </p>
    </LegalLayout>
  );
}
