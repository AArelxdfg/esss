# Remaining Windows checks (10–20 minutes)

1. ACTION: Open the installed or unpacked LLera app and switch Work/Conversation surfaces.
   EXPECTED RESULT: MONOLITH workspace renders; keyboard focus and command palette work.
   PASS: No renderer error and visible surface changes work. FAIL: blank/crashed renderer or broken focus.
2. ACTION: Send one prompt using a configured local model.
   EXPECTED RESULT: One llama.cpp runtime responds, then stops/restarts cleanly.
   PASS: Response and no duplicate runtime. FAIL: no response, crash, or duplicate runtime.
3. ACTION: Import an image, a file, and OCR a screenshot with Windows OCR available.
   EXPECTED RESULT: Each input has provenance and OCR returns known text.
   PASS: Correct text/provenance. FAIL: ingestion, OCR, or provenance failure.
4. ACTION: Inspect active backend/GPU while running the prompt.
   EXPECTED RESULT: Recorded backend/device matches actual use.
   PASS: Telemetry proves selected GPU backend. FAIL: CPU fallback or no telemetry.
5. ACTION: Run the generated NSIS installer, launch, uninstall, and inspect user-data preservation.
   EXPECTED RESULT: Binaries/shortcuts are removed, unrelated/user data is retained.
   PASS: Install/launch/uninstall all complete safely. FAIL: install failure or broad deletion.
