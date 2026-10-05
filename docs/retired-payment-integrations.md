# Retired payment integrations

MoneyGram and Durianpay are no longer supported. Their routes, checkout options,
workers, and environment configuration have been removed. Direct Stellar and
CCTP payments and Stellar wallet withdrawals remain supported.

Historical database migrations are retained so existing migration histories stay
valid. This cleanup does not delete historical payment records or run database
migrations. The browser still reads legacy bridge keys solely for stranded-fund
recovery, and clears their secret after recovery; it cannot create new provider
sessions.

When deploying, remove retired provider variables from the deployment secret
store and recreate the compose stack with `docker compose up -d --remove-orphans`
to stop the removed fiat settlement service. Keep any historical recovery keys in
an appropriate secure archive if unresolved historical records still require them.
