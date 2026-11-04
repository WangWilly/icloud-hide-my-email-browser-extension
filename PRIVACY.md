# Privacy policy for iCloud Hide My Email

Effective date is November 4, 2026.

iCloud Hide My Email is a browser extension maintained in the [WangWilly source repository](https://github.com/WangWilly/icloud-hide-my-email-browser-extension). It helps you create, fill, and manage email aliases in your own iCloud account.

## Information the extension handles

You sign in directly at Apple's icloud.com website. The extension uses the iCloud session already managed by your browser to call iCloud. It does not ask for your Apple password, read your two-factor authentication codes, or copy cookie values into extension storage.

iCloud returns your Hide My Email aliases and their account information, including forwarding email addresses, titles, notes, creation dates, active status, and identifiers needed to manage each alias. The extension uses this information to display, search, copy, edit, activate, deactivate, and delete aliases when you request those actions. It does not read your mailbox messages.

The extension reads the active tab's URL and uses the site's hostname to suggest an editable alias title and note and find aliases saved for that site. Inline suggestions use the site's host, which can include a port. Saving an alias sends its selected title, note, and site label to iCloud. The extension does not save a chronological browsing history or send the page URL path or query string as alias metadata.

On HTTP and HTTPS websites where autofill is enabled, the extension detects email input fields. Focusing a supported field requests a candidate alias from iCloud and displays it as a suggestion on the page. The website can read the displayed candidate. Choosing the suggestion saves the alias in iCloud and writes it into the field. The website can also read the filled value in its form. The extension does not submit the website's form or upload values already typed into the website's fields.

Copy actions write an alias to your clipboard. The extension does not read the clipboard.

## Local storage

The extension saves autofill preferences, muted-site hostnames, popup screen state, and iCloud service addresses in the browser's local extension storage. This state is not sent to a developer server or synchronized through the extension's code.

Alias lists, forwarding choices, and edits are held in memory while the relevant extension page is open. Saved aliases and metadata remain in your iCloud account. Signing out clears the extension's saved iCloud client state and returns the popup to the signed-out screen. Autofill preferences and muted sites remain until you change them or remove the extension.

## Network requests and sharing

The extension sends its alias and account operations to Apple's iCloud services over HTTPS. It uses icloud.com and icloud.com.cn service hosts for the matching iCloud regions. Apple handles information sent to iCloud under Apple's own policies and account settings.

To renew an existing session, the extension may open the matching icloud.com web app in a temporary background tab. Apple's website manages any sign-in renewal. The extension closes that tab after renewal or timeout.

The extension has no developer-operated data server, advertising SDK, or analytics reporting. It does not sell user data or share it with advertising platforms or data brokers. The extension's user data is used only for the alias and settings functions described here.

Links to source code, support, and iCloud pages open external websites when you choose them. Those websites receive ordinary visits and apply their own privacy policies. Information you choose to post in a public GitHub support issue is public.

## Your controls

You can disable inline suggestions or the context menu in Options. You can mute suggestions for an individual site and unmute it later. You can edit alias titles and notes and manage aliases through the extension or directly in iCloud. Deleting extension storage or uninstalling the extension removes its saved local settings according to your browser's controls. Uninstalling does not delete aliases saved in iCloud. Use iCloud or the alias management controls to manage those records.

## Chrome Web Store Limited Use

The extension's use of user data complies with the Chrome Web Store User Data Policy, including the Limited Use requirements. Data is used only to create, fill, and manage your iCloud Hide My Email aliases and settings. It is not used for advertising, credit, or lending decisions.

## Changes and contact

This policy is updated when the extension's data practices change. The effective date identifies the current policy.

For questions or reports, use the repository's [GitHub Issues page](https://github.com/WangWilly/icloud-hide-my-email-browser-extension/issues). Do not post passwords, session cookies, two-factor authentication codes, or private account data in a public issue.
