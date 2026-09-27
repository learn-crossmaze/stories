#!/usr/bin/env bash
# Lets GitHub Actions deploy to a Firebase project without a JSON key:
# creates a deploy service account, a Workload Identity pool + GitHub OIDC
# provider restricted to this repository, and prints the three variables to set
# on the matching GitHub environment. Idempotent; safe to re-run.
#
#   tools/firebase/setup-github-deploy.sh <project-id> [owner/repo]
#
# Requires gcloud signed in as a project owner (`gcloud auth login`).
set -euo pipefail

PROJECT="${1:?usage: setup-github-deploy.sh <project-id> [owner/repo]}"
REPO="${2:-learn-crossmaze/stories}"
POOL=github
PROVIDER=github-actions
SA_NAME=github-deploy
SA="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"

gcloud config set project "$PROJECT" >/dev/null
NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')

echo "▸ APIs"
gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  firebasehosting.googleapis.com firebaserules.googleapis.com firestore.googleapis.com

echo "▸ Service account $SA"
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 \
  || gcloud iam service-accounts create "$SA_NAME" --display-name "GitHub Actions deploy"

# Least privilege for `firebase deploy --only firestore:rules,firestore:indexes,hosting`
# and preview channels. Add roles/cloudfunctions.developer etc. when Functions land.
for role in roles/firebasehosting.admin roles/firebaserules.admin roles/datastore.indexAdmin \
            roles/firebase.viewer roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$SA" \
    --role "$role" --condition None >/dev/null
done

echo "▸ Workload Identity pool/provider"
gcloud iam workload-identity-pools describe "$POOL" --location global >/dev/null 2>&1 \
  || gcloud iam workload-identity-pools create "$POOL" --location global --display-name "GitHub"
gcloud iam workload-identity-pools providers describe "$PROVIDER" \
  --workload-identity-pool "$POOL" --location global >/dev/null 2>&1 \
  || gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --workload-identity-pool "$POOL" --location global \
    --issuer-uri https://token.actions.githubusercontent.com \
    --attribute-mapping 'google.subject=assertion.sub,attribute.repository=assertion.repository' \
    --attribute-condition "assertion.repository == '${REPO}'"

gcloud iam service-accounts add-iam-policy-binding "$SA" --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/${NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${REPO}" \
  >/dev/null

cat <<EOF

Done. Set these on the GitHub environment (Settings → Environments → <env> → Variables):

  FIREBASE_PROJECT_ID         ${PROJECT}
  GCP_WIF_PROVIDER            projects/${NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}
  GCP_DEPLOY_SERVICE_ACCOUNT  ${SA}
EOF
