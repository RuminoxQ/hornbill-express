#!/usr/bin/env python3
"""One-time Firebase setup for Hornbill Express.

Deploys the security rules and turns on the 7-day auto-delete (TTL) for `scores` and `passports`.
Needs the Firebase CLI (npm install -g firebase-tools; firebase login). If it isn't installed,
the script prints the console steps and the gcloud commands instead.

Usage:  python tools/setup_firebase.py --project your-project-id
"""
import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COLLECTIONS = ["scores", "passports"]


def run(cmd):
    print("$ " + " ".join(cmd))
    return subprocess.call(cmd, cwd=ROOT)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True, help="Firebase project ID")
    a = ap.parse_args()

    if shutil.which("firebase"):
        # firestore.indexes.json carries the TTL field overrides, so one deploy sets rules + TTL
        code = run(["firebase", "deploy", "--only", "firestore", "--project", a.project])
        if code == 0:
            print("\nDone. Rules deployed and TTL on `expireAt` requested for: " + ", ".join(COLLECTIONS))
            print("TTL policies can take a few minutes to become active. Check: Firebase console → Firestore → Time-to-live.")
        sys.exit(code)

    if shutil.which("gcloud"):
        for c in COLLECTIONS:
            run(["gcloud", "firestore", "fields", "ttls", "update", "expireAt", f"--collection-group={c}", "--enable-ttl", "--async", f"--project={a.project}"])
        print("\nTTL requested. Now publish the rules: Firebase console → Firestore → Rules → paste firestore.rules → Publish.")
        return

    print("""Neither the Firebase CLI nor gcloud is installed. Do it in the browser:

1. Firebase console → Firestore Database → Rules: paste the contents of firestore.rules, then Publish.
2. Google Cloud console → Firestore → Time-to-live → Create policy:
     collection group: scores     timestamp field: expireAt
     collection group: passports  timestamp field: expireAt
   (Records are deleted automatically, typically within 24 hours after they expire.)

Or install the CLI (npm install -g firebase-tools, then firebase login) and run this script again.""")


if __name__ == "__main__":
    main()
