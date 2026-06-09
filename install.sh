#!/bin/bash
set -e

echo "=== Brave Tasks Extension — Instalación ==="
echo ""

EXTENSION_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_DIR="/usr/local/lib/brave-tasks"
MANIFEST_DIR="/etc/opt/chrome/native-messaging-hosts"

# For Brave (chromium-based), also install for chromium
BRAVE_MANIFEST_DIR="/etc/opt/brave/native-messaging-hosts"

# 1. Copy native host script
echo "[1/3] Instalando host nativo..."
sudo mkdir -p "$HOST_DIR"
sudo cp "$EXTENSION_DIR/native-host/brave-tasks.py" "$HOST_DIR/"
sudo chmod +x "$HOST_DIR/brave-tasks.py"

# 2. Copy companion script
echo "[2/3] Instalando script para polybar/waybar..."
sudo cp "$EXTENSION_DIR/native-host/brave-tasks.sh" "/usr/local/bin/brave-tasks"
sudo chmod +x "/usr/local/bin/brave-tasks"

# 3. Install native messaging manifest
echo "[3/3] Instalando manifiesto de mensajería nativa..."

# Get the extension ID from the extension
echo ""
echo "IMPORTANTE:"
echo "  1. Abre brave://extensions"
echo "  2. Activa 'Modo de desarrollador'"
echo "  3. Haz clic en 'Cargar descomprimida'"
echo "  4. Selecciona: $EXTENSION_DIR"
echo "  5. Copia el ID que aparece (ej: abcdefghijklmnopabcdefghijklmn)"
echo ""
read -p "Pega el ID de la extensión: " EXT_ID

if [ -n "$EXT_ID" ]; then
  # Update the manifest with the real extension ID
  sudo mkdir -p "$MANIFEST_DIR"
  cat "$EXTENSION_DIR/native-host/com.anomalyco.brave_tasks.json" | \
    sed "s/__MSG_@@extension_id__/$EXT_ID/g" | \
    sudo tee "$MANIFEST_DIR/com.anomalyco.brave_tasks.json" > /dev/null

  # Also for Brave
  sudo mkdir -p "$BRAVE_MANIFEST_DIR"
  sudo cp "$MANIFEST_DIR/com.anomalyco.brave_tasks.json" "$BRAVE_MANIFEST_DIR/"

  echo ""
  echo "✓ Instalación completa. Recarga la extensión en brave://extensions"
else
  echo "Omitiendo instalación del manifest nativo."
  echo "Puedes ejecutar este script de nuevo cuando tengas el ID."
fi

echo ""
echo "=== Uso con polybar ==="
echo 'Agrega esto a tu ~/.config/polybar/config:'
echo '  [module/brave-tasks]'
echo '  type = custom/script'
echo '  exec = brave-tasks -c'
echo '  interval = 5'
echo '  label = %output% tareas'
echo ""
echo "=== Uso con waybar ==="
echo 'Agrega esto a ~/.config/waybar/config:'
echo '  "custom/brave-tasks": {'
echo '    "exec": "brave-tasks -j",'
echo '    "interval": 5,'
echo '    "return-type": "json"'
echo '  }'
echo ""
echo "=== Uso con i3blocks ==="
echo 'Agrega esto a ~/.config/i3blocks/config:'
echo '  [brave-tasks]'
echo '  command=brave-tasks'
echo '  interval=5'
echo ""
echo "Si el host nativo no está instalado, la extensión funciona igual"
echo "con la sincronización entre sesiones de Brave."
