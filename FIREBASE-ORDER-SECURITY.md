# SF-Gallery: secure order pricing

The callable Cloud Function `createCustomerOrder` reads current product prices and delivery fees from Realtime Database, calculates the order total on the server, and writes the order using the Admin SDK. Customers must not be allowed to write directly to the `orders` tree.

## Before enabling the new checkout

1. Upgrade the Firebase project to the Blaze (pay-as-you-go) plan. Cloud Functions deployment may require billing. Check current Firebase pricing and set a budget alert.
2. From a computer or a cloud development environment with Firebase CLI installed, run:
   `firebase login`
   `firebase use sf-gallery-ec41d`
   `firebase deploy --only functions:createCustomerOrder`
3. Wait until deployment succeeds.
4. In Realtime Database Rules, change the write rule under `orders/$uid/$orderId` so that only the admin UID can write directly. The Cloud Function uses the Admin SDK and bypasses client database rules:

   `".write": "auth != null && auth.uid === 'aDD6jv8lJsQMZB186oPByTC1Hy1'"`

   Keep the existing customer/admin read rules. Do not add a customer write permission back.
5. Only after the function is deployed and the rule is published, update the storefront checkout to call `createCustomerOrder` instead of writing orders directly.

## Important

Do not publish the orders write-rule restriction before the function is deployed and the storefront is switched to call it, or customer checkout will stop working. The current storefront has not yet been switched to the callable function.
