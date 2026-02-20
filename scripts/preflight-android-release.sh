#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$ROOT_DIR/android"
ANDROID_APP_DIR="$ANDROID_DIR/app"
ENV_FILE="$ROOT_DIR/.env"
GRADLE_PROPS_FILE="$ANDROID_DIR/gradle.properties"
KEYSTORE_PROPS_FILE="$ANDROID_DIR/keystore.properties"
APP_JSON_FILE="$ROOT_DIR/app.json"

ok() {
  printf "OK: %s\n" "$1"
}

fail() {
  printf "ERROR: %s\n" "$1"
}

trim_quotes() {
  local value="$1"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf "%s" "$value"
}

get_kv_from_file() {
  local file="$1"
  local key="$2"
  if [[ ! -f "$file" ]]; then
    return 0
  fi
  local raw
  raw="$(grep -E "^[[:space:]]*${key}=" "$file" | tail -n 1 | cut -d '=' -f 2- || true)"
  trim_quotes "$raw"
}

get_env_or_dotenv() {
  local key="$1"
  local value="${!key:-}"
  if [[ -n "${value}" ]]; then
    trim_quotes "$value"
    return 0
  fi
  get_kv_from_file "$ENV_FILE" "$key"
}

get_app_json_extra() {
  local key="$1"
  if [[ ! -f "$APP_JSON_FILE" ]]; then
    return 0
  fi
  node -e "
    try {
      const fs = require('fs');
      const json = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
      const extra = json?.expo?.extra || {};
      const value = extra[process.argv[2]];
      if (typeof value === 'string') process.stdout.write(value);
    } catch (_) {}
  " "$APP_JSON_FILE" "$key"
}

get_signing_value() {
  local env_key="$1"
  local gradle_key="$2"
  local keystore_key="$3"

  local value="${!env_key:-}"
  if [[ -n "$value" ]]; then
    trim_quotes "$value"
    return 0
  fi

  value="$(get_kv_from_file "$GRADLE_PROPS_FILE" "$gradle_key")"
  if [[ -n "$value" ]]; then
    printf "%s" "$value"
    return 0
  fi

  value="$(get_kv_from_file "$KEYSTORE_PROPS_FILE" "$keystore_key")"
  printf "%s" "$value"
}

resolve_store_file() {
  local candidate="$1"
  if [[ -z "$candidate" ]]; then
    return 0
  fi

  if [[ -f "$ANDROID_APP_DIR/$candidate" ]]; then
    printf "%s" "$ANDROID_APP_DIR/$candidate"
    return 0
  fi
  if [[ -f "$candidate" ]]; then
    printf "%s" "$candidate"
    return 0
  fi
  if [[ -f "$ROOT_DIR/$candidate" ]]; then
    printf "%s" "$ROOT_DIR/$candidate"
    return 0
  fi
  if [[ -f "$ANDROID_DIR/$candidate" ]]; then
    printf "%s" "$ANDROID_DIR/$candidate"
    return 0
  fi
}

main() {
  local has_errors=0

  echo "== Android release preflight =="

  local supabase_url supabase_anon
  supabase_url="$(get_env_or_dotenv "EXPO_PUBLIC_SUPABASE_URL")"
  supabase_anon="$(get_env_or_dotenv "EXPO_PUBLIC_SUPABASE_ANON_KEY")"
  if [[ -z "$supabase_url" ]]; then
    supabase_url="$(get_app_json_extra "supabaseUrl")"
  fi
  if [[ -z "$supabase_anon" ]]; then
    supabase_anon="$(get_app_json_extra "supabaseAnonKey")"
  fi

  if [[ -n "$supabase_url" ]]; then
    ok "Supabase URL presente (env/.env/app.json)"
  else
    fail "Falta EXPO_PUBLIC_SUPABASE_URL (env/.env) o expo.extra.supabaseUrl (app.json)"
    has_errors=1
  fi

  if [[ -n "$supabase_anon" ]]; then
    ok "Supabase ANON KEY presente (env/.env/app.json)"
  else
    fail "Falta EXPO_PUBLIC_SUPABASE_ANON_KEY (env/.env) o expo.extra.supabaseAnonKey (app.json)"
    has_errors=1
  fi

  local release_store_file release_store_password release_key_alias release_key_password
  release_store_file="$(get_signing_value "ANDROID_RELEASE_STORE_FILE" "android.releaseStoreFile" "storeFile")"
  release_store_password="$(get_signing_value "ANDROID_RELEASE_STORE_PASSWORD" "android.releaseStorePassword" "storePassword")"
  release_key_alias="$(get_signing_value "ANDROID_RELEASE_KEY_ALIAS" "android.releaseKeyAlias" "keyAlias")"
  release_key_password="$(get_signing_value "ANDROID_RELEASE_KEY_PASSWORD" "android.releaseKeyPassword" "keyPassword")"

  local resolved_keystore
  resolved_keystore="$(resolve_store_file "$release_store_file")"
  if [[ -n "$resolved_keystore" ]]; then
    ok "Keystore encontrado en: $resolved_keystore"
  else
    fail "No se encontró el keystore (ANDROID_RELEASE_STORE_FILE/android.releaseStoreFile/storeFile)"
    has_errors=1
  fi

  if [[ -n "$release_store_password" ]]; then
    ok "Store password presente"
  else
    fail "Falta store password (ANDROID_RELEASE_STORE_PASSWORD/android.releaseStorePassword/storePassword)"
    has_errors=1
  fi

  if [[ -n "$release_key_alias" ]]; then
    ok "Key alias presente"
  else
    fail "Falta key alias (ANDROID_RELEASE_KEY_ALIAS/android.releaseKeyAlias/keyAlias)"
    has_errors=1
  fi

  if [[ -n "$release_key_password" ]]; then
    ok "Key password presente"
  else
    fail "Falta key password (ANDROID_RELEASE_KEY_PASSWORD/android.releaseKeyPassword/keyPassword)"
    has_errors=1
  fi

  local version_code version_name
  version_code="$(get_kv_from_file "$GRADLE_PROPS_FILE" "android.versionCode")"
  version_name="$(get_kv_from_file "$GRADLE_PROPS_FILE" "android.versionName")"

  if [[ -n "$version_code" ]]; then
    ok "android.versionCode=$version_code"
  else
    fail "Falta android.versionCode en android/gradle.properties"
    has_errors=1
  fi

  if [[ -n "$version_name" ]]; then
    ok "android.versionName=$version_name"
  else
    fail "Falta android.versionName en android/gradle.properties"
    has_errors=1
  fi

  if [[ "$has_errors" -ne 0 ]]; then
    echo
    echo "Preflight FAILED. Corrige los puntos anteriores antes de bundleRelease."
    exit 1
  fi

  echo
  echo "Preflight OK. Puedes compilar:"
  echo "cd android && NODE_ENV=production ./gradlew :app:bundleRelease"
}

main "$@"
