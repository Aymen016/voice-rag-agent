# Account Security and Sign-in

This document covers password rules, two-step verification, recovering access to a locked account, and how CloudNest protects stored data.

## Passwords

Passwords must be at least 10 characters long. CloudNest checks new passwords against lists of known breached passwords and rejects matches. Passwords can be changed under Settings > Security.

## Two-step verification

Two-step verification (2SV) adds a second check at sign-in on top of the password. CloudNest supports authenticator apps (time-based one-time codes) and hardware security keys. SMS codes are not supported because they are vulnerable to SIM swapping.

To enable it, go to Settings > Security > Two-step verification and scan the QR code with an authenticator app. During setup, CloudNest shows 10 single-use backup codes. Store them somewhere safe; each code can be used once if the phone is unavailable.

Business admins can require 2SV for every member of the organization from the admin console.

## Forgotten password

Select "Forgot password" on the sign-in page and enter the account email. A reset link valid for 60 minutes is sent to that address. Resetting the password signs the account out of all other devices.

## Lost access to two-step verification

If the authenticator device and all backup codes are lost, the customer must complete identity verification with support. This requires access to the account email address and the last 4 digits of the payment card on file (for paid plans). For security reasons, recovery takes up to 3 business days and cannot be expedited.

## Suspicious activity

CloudNest emails the account owner when a new device signs in. The list of active sessions is shown under Settings > Security > Devices, where any session can be signed out remotely. If a customer believes their account was compromised, they should reset the password immediately, sign out all sessions, and contact support.

## Encryption

Files are encrypted in transit with TLS 1.3 and at rest with AES-256. CloudNest staff cannot view file contents without the customer granting temporary access during a support case.
