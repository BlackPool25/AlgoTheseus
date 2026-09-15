import { LegalLayout } from "./LegalLayout";

export function Terms() {
  return (
    <LegalLayout title="Terms of Service" updated="2026-09-15">
      <h2>The service</h2>
      <p>
        AlgoTheseus provides a free, no-account tool that compiles and runs
        user-supplied C++ code ephemerally in an isolated sandbox (roughly 10
        seconds CPU / 128&nbsp;MB memory per run) and visualizes the resulting
        execution trace in your browser.
      </p>
      <h2>Acceptable use</h2>
      <p>
        You agree not to misuse the service. Prohibited conduct includes, but
        is not limited to: submitting malware or exploit code, crypto-mining
        workloads, attempts to escape, overload, or probe the sandbox or
        backend, denial-of-service or rate-limit evasion, and any use that
        violates applicable law. We may throttle, block, or refuse runs that
        appear abusive, with no notice and no liability.
      </p>
      <h2>Your code</h2>
      <p>
        You retain all rights to code you submit. By pressing “Run” you grant
        us only the transient right to compile, execute, and discard that code
        as needed to return your trace. Do not submit secrets, credentials, or
        code you do not have the right to run.
      </p>
      <h2>No warranty</h2>
      <p>
        The service is provided “as is” and “as available”, without warranties
        of any kind, express or implied, including merchantability, fitness for
        a particular purpose, accuracy of traces, and non-infringement. To the
        maximum extent permitted by law, we are not liable for any loss or
        damage arising from your use of the service.
      </p>
      <h2>Changes</h2>
      <p>
        We may update these terms; continued use after an update constitutes
        acceptance. Questions: see our <a href="/contact">contact page</a>.
      </p>
    </LegalLayout>
  );
}
