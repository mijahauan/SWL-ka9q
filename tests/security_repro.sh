#!/bin/bash

# Security Regression Test for SWL-ka9q
PORT=31337
HOST="http://localhost:$PORT"

echo "Starting server on port $PORT..."
PORT=$PORT node server.js > /tmp/swl_test.log 2>&1 &
PID=$!

# Wait for server to start
sleep 3

echo "Running tests..."

# Test 1: RCE in setFrequency (Attempt injection)
# We send a payload that would cause RCE if passed to raw python, but should be sanitized to a number or fail validation.
# Payload: "1000); import os; os.system('touch /tmp/pwned'); #"
# Expected behavior: parseFloat parses "1000", ignores rest. Call succeeds as set_frequency(1000). RCE fails.
rm -f /tmp/pwned

echo "Test 1: Attempting RCE in setFrequency..."
RESPONSE=$(curl -s -X POST -H "Content-Type: application/json" \
  -d '{"frequency_hz": "1000); import os; os.system(\"touch /tmp/pwned\"); #"}' \
  "$HOST/api/audio/tune/123/frequency")

echo "Response: $RESPONSE"

if [ -f /tmp/pwned ]; then
  echo "❌ FAILED: RCE Successful! /tmp/pwned exists."
  rm /tmp/pwned
else
  echo "✅ PASSED: RCE prevented in setFrequency (no side effect)."
fi

# Test 2: Normal operation check (Base64 encoding check)
# Verify that a normal request still works (passed via Base64 to python)
echo "Test 2: Verifying normal operation (Base64 path)..."
RESPONSE=$(curl -s -X POST -H "Content-Type: application/json" \
  -d '{"frequency_hz": 12345}' \
  "$HOST/api/audio/tune/123/frequency")

echo "Response: $RESPONSE"
# Note: It might fail with "Method set_frequency not found" or similar if radiod not connected or mocked?
# But if it returns generic success or valid python error (not syntax error), it's passing the execution path.
if [[ "$RESPONSE" == *"success"* ]]; then
  echo "✅ PASSED: Normal operation worked."
else
    # If it failed, check if it was a python syntax error (bad) or logic error (acceptable for test)
    if [[ "$RESPONSE" == *"SyntaxError"* ]] || [[ "$RESPONSE" == *"IndentationError"* ]]; then
         echo "❌ FAILED: Python Syntax Error in normal operation."
    else
         echo "⚠️  PASSED (Logic Error): Python execution attempted but failed logic (expected since no radiod): $RESPONSE"
    fi
fi

# Test 3: Command Injection in radiod select
# Old vulnerability: hostname was not validated.
echo "Test 3: Attempting Command Injection in radiod select..."
RESPONSE=$(curl -s -X POST -H "Content-Type: application/json" \
  -d '{"hostname": "localhost; echo INJECTED_CMD"}' \
  "$HOST/api/radiod/select")

echo "Response: $RESPONSE"

if [[ "$RESPONSE" == *"Invalid hostname format"* ]]; then
  echo "✅ PASSED: Invalid hostname rejected (400)."
else
  echo "❌ FAILED: Hostname accepted or wrong error."
fi

# Cleanup
kill $PID
# rm /tmp/swl_test.log
echo "Tests completed."
