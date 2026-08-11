# MoneyGram Playground certification

This runbook is limited to MoneyGram's Stellar sandbox and uses testnet USDC. Configure the deployment with `NEXT_PUBLIC_SEP24_ANCHOR_URL=https://extmgxanchor.moneygram.com`, testnet issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`, `NEXT_PUBLIC_MONEYGRAM_RAMP_STATUS=sandbox`, and the exact client domain/signing secret allowlisted in the partner portal. Before moving funds, confirm MoneyGram's live `stellar.toml` still advertises the testnet passphrase, issuer, signing key, SEP-10 endpoint, and SEP-24 endpoint.

Use a distinct 15 USDC transaction for each procedure. Save the MGI transaction ID shown in Olio, the Stellar transaction hash when applicable, and screenshots of the MoneyGram status UI.

## 1. Cash-out

1. Open Withdraw, select a 15 USDC private payment, and choose MoneyGram cash pickup.
2. Complete the hosted identity and pickup flow.
3. At `pending_user_transfer_start`, confirm Olio sends exactly 15 USDC to `withdraw_anchor_account` with the returned memo and type within the 30-minute window.
4. At `pending_user_transfer_complete`, copy the MGI transaction ID and pickup reference, open `more_info_url`, and record the Stellar hash and screenshots.

## 2. Cash-out refund

1. Start a separate 15 USDC cash-out and reach `pending_user_transfer_complete`.
2. Open `more_info_url`, choose **Cancel transfer**, and refresh Olio until the status is `refunded`.
3. Wait for the live 15 USDC balance to return to the saved disposable account. Use Olio's recovery panel to transfer it to a user-controlled Stellar G-account.
4. Copy this flow's distinct MGI transaction ID and retain the outbound/refund/recovery hashes and screenshots. Dismiss local evidence only after the live balance is zero.

## 3. Staged cash-in

1. Open Receive and select **Add cash with MoneyGram**. Enter 15 USDC.
2. Choose a documented sandbox location, for example **CUB FOODS SILVER LAKE, 3930 SILVER LAKE RD NE, MINNEAPOLIS MN, USA**.
3. Commit the hosted flow and wait for `pending_user_transfer_start` (or trusted `COMMIT_RESULT`). Do not wait for store settlement in this certification scope.
4. Copy the third MGI transaction ID and retain screenshots. The disposable key remains device-local so unexpected test USDC can be recovered.

## Partner portal evidence

Paste the three distinct MGI IDs into **Developers → Playground test transactions** as cash-out, cash-out refund, and cash-in. Internally retain: MGI ID, flow kind, amount, status, MoneyGram reference, bridge public key, Stellar hashes, `more_info_url`, timestamps, and screenshots.

Source: [MoneyGram Stellar integration guide](https://xramps.moneygram.com/ops/dev/stellar).
