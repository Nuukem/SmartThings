#!/bin/bash
# Helper script to get SmartThings device IDs

if [ -z "$1" ]; then
    echo "Usage: ./get-device-ids.sh <your_smartthings_token>"
    echo ""
    echo "Steps to get your token:"
    echo "1. Go to https://account.smartthings.com/tokens"
    echo "2. Click 'Generate new token'"
    echo "3. Name it 'Device Lookup'"
    echo "4. Select these scopes:"
    echo "   - d:devicemanagementread"
    echo "   - d:deviceprofileread"
    echo ""
    exit 1
fi

TOKEN=$1

echo "🔍 Fetching all SmartThings devices..."
echo ""

curl -s -X GET "https://api.smartthings.com/v1/devices" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" | jq '.items[] | {
    id: .deviceId,
    name: .name,
    type: .deviceTypeName,
    status: .components[0].capabilities[0].id
  }' | jq -s 'sort_by(.name)'

echo ""
echo "✅ Devices above:"
echo "   Look for your garage door sensor (usually Door Lock or Contact Sensor)"
echo "   Look for your Alexa device"
echo ""
echo "Copy the 'id' value and paste it into your .env file"
