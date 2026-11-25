#!/usr/bin/env python3
"""One-time Firebase setup for Hornbill Express.

Deploys the security rules. Expired records (older than 7 days) are deleted by the game itself, which works
on the free Spark plan. With --ttl (needs the paid Blaze plan) it also turns on Firestore's own TTL policy.
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
    ap.add_argument("--ttl", action="store_true", help="also enable Firestore TTL (Blaze plan only)")
    a = ap.parse_args()

    if shutil.which("firebase"):
        # firestore.indexes.json carries the TTL field overrides, so one deploy sets rules + TTL
        code = run(["firebase", "deploy", "--only", "firestore:rules", "--project", a.project])
        if code == 0 and a.ttl:
            for c in COLLECTIONS:
                if shutil.which("gcloud"):
                    run(["gcloud", "firestore", "fields", "ttls", "update", "expireAt", f"--collection-group={c}", "--enable-ttl", "--async", f"--project={a.project}"])
            if not shutil.which("gcloud"):
                print("For TTL, copy firestore.indexes.blaze.json over firestore.indexes.json and run: firebase deploy --only firestore:indexes")
        if code == 0:
            print("\nDone. Rules deployed. Expired records are swept by the game every 30 minutes while a booth device or the TV is open.")
        sys.exit(code)

    if shutil.which("gcloud") and a.ttl:
        for c in COLLECTIONS:
            run(["gcloud", "firestore", "fields", "ttls", "update", "expireAt", f"--collection-group={c}", "--enable-ttl", "--async", f"--project={a.project}"])
        print("\nTTL requested. Now publish the rules: Firebase console → Firestore → Rules → paste firestore.rules → Publish.")
        return

    print("""Neither the Firebase CLI nor gcloud is installed. Do it in the browser:

1. Firebase console → Firestore Database → Rules: paste the contents of firestore.rules, then Publish.
   That's all you need: the game deletes records older than 7 days by itself.
2. Optional, Blaze plan only: Google Cloud console → Firestore → Time-to-live → Create policy
     collection group: scores     timestamp field: expireAt
     collection group: passports  timestamp field: expireAt

Or install the CLI (npm install -g firebase-tools, then firebase login) and run this script again.""")


if __name__ == "__main__":
    main()
