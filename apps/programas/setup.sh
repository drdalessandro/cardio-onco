#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
# SPDX-License-Identifier: Apache-2.0
#
# Arma "Programas" (app del paciente) desde FooMedical upstream + el overlay
# cardio-oncológico.
#
# Se clona el upstream en vez de vendorizarlo a propósito: el fork anterior
# quedó atrapado en @medplum 0.9.33 justamente por divergir. Manteniendo el
# upstream como remoto, actualizar Medplum es `git pull upstream main`.
#
#   Uso:  ./setup.sh [directorio-destino]        (default: ../../../programas-cardio-onco)

set -euo pipefail

UPSTREAM="https://github.com/medplum/foomedical.git"
# Commit verificado: "Release Version 5.1.27" (2026-07-24). Fijado para que el
# armado sea reproducible; subilo a conciencia cuando quieras actualizar.
UPSTREAM_REF="${UPSTREAM_REF:-c3f02cb}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${1:-$HERE/../../../programas-cardio-onco}"

if [ -e "$DEST" ]; then
  echo "✗ El destino ya existe: $DEST"
  echo "  Borralo o pasá otra ruta:  ./setup.sh /ruta/nueva"
  exit 1
fi

echo "━━━ Programas — armado desde FooMedical ━━━"
echo "  upstream: $UPSTREAM @ $UPSTREAM_REF"
echo "  destino:  $DEST"
echo

git clone "$UPSTREAM" "$DEST"
git -C "$DEST" checkout --quiet "$UPSTREAM_REF"

# Deja el upstream como remoto para poder seguir actualizando Medplum.
git -C "$DEST" remote rename origin upstream
echo "✓ upstream clonado (remoto 'upstream' conservado)"

# El overlay pisa sólo lo que cambia respecto de FooMedical.
cp -R "$HERE/overlay/." "$DEST/"
echo "✓ overlay cardio-oncológico aplicado:"
(cd "$HERE/overlay" && find . -type f | sed 's|^\./|    |')

# La página de facturación no aplica a un hospital público y su recurso
# (PaymentNotice) no está en la AccessPolicy del paciente.
rm -f "$DEST/src/pages/account/MembershipAndBilling.tsx"
echo "✓ página de facturación eliminada"

if [ ! -f "$DEST/.env" ]; then
  cp "$DEST/.env.defaults" "$DEST/.env"
  echo "✓ .env creado desde .env.defaults"
fi

cat <<EOF

━━━ Listo ━━━

Siguiente:
  1. cd "$DEST"
  2. Editá .env — MEDPLUM_PROJECT_ID debe ser el MISMO Project que cardio-onco.
  3. npm install && npm run dev

Antes de abrir a pacientes reales, en el repo cardio-onco:
  npm run bootstrap -- --execute      # instala AccessPolicy + el Questionnaire
  y marcá 'cardio-onco-patient' como default patient access policy del Project.
EOF
