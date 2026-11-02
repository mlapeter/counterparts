- **Hosted: the restore drill is in the repository, and the KEK check is by fingerprint.** `hosted/drill/drill.sh`
  restores production's deployed image from a drill bucket on R2 with a throwaway key, and writes its results outside
  the repository. The offline copies of the key are now checked by a short fingerprint against Railway's, so the real
  key no longer goes into a drill. The runbook says what to do when a restore refuses a mistyped key.
