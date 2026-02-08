# FE-001: Create New Message Page / Popup

**Type:** Frontend
**App:** turumba (turumba_web_core)
**Feature Area:** Messaging
**Figma:** (link to Figma design)

---

## Summary

Create a page or popup where a user composes and sends a new message. The user selects a delivery channel, enters the recipient's delivery address, and writes the message body — which supports template variables that will be resolved later by the backend processor.

---

## Requirements

### 1. Trigger / Entry Point

- A "New Message" button (location TBD per Figma) opens the compose UI
- The compose UI can be either a full page or a modal/popup depending on the Figma design
- The UI should be accessible from the main messaging section of the dashboard

### 2. Delivery Channel Selector

- A selector (dropdown, radio group, or segmented control per Figma) for choosing the delivery channel
- Available channels:
  - **SMS**
  - **Telegram**
  - **WhatsApp**
  - **Facebook Messenger**
  - **Email**
- The selected channel determines the delivery address input format and validation (see section 3)
- Only channels that are configured/enabled for the user's account should be selectable
- Default to the first available channel or the most recently used channel

### 3. Delivery Address Input

The input field adapts based on the selected channel:

| Channel | Address Label | Format / Validation |
|---------|--------------|---------------------|
| SMS | Phone Number | International format with country code (e.g., +251912345678) |
| Telegram | Phone Number or Username | Phone number or @username |
| WhatsApp | Phone Number | International format with country code |
| Facebook Messenger | Messenger ID | Platform-specific ID |
| Email | Email Address | Standard email validation |

- Provide clear placeholder text indicating the expected format (e.g., "+251..." for SMS)
- Show inline validation errors for invalid formats
- Consider an autocomplete/search against existing contacts — when the user starts typing, suggest matching contacts from the account's contact list

### 4. Message Composer

- A text area for composing the message body
- Support **template variables** using the `{VARIABLE_NAME}` syntax
- Template variable behavior:
  - Variables are placeholders that will be replaced by the backend processor with actual contact data at send time
  - Common variables: `{FIRST_NAME}`, `{LAST_NAME}`, `{PHONE}`, `{EMAIL}`, `{ACCOUNT_NAME}`, etc.
  - The composer should provide a way to insert variables (e.g., a dropdown/button that inserts the variable tag at the cursor position)
  - Inserted variables should be visually distinct in the composer (e.g., highlighted, chip-styled, or different color) so the user can clearly see what is a variable vs plain text
- Show a **character count** — some channels have limits (SMS: 160 chars per segment)
- Show a **message preview** section that displays how the message will look with example variable values (e.g., `{FIRST_NAME}` shown as "John")

### 5. Form Actions

- **Send** button — submits the message for immediate delivery
- **Cancel** button — closes the popup/navigates back, with a confirmation prompt if the user has unsaved content
- The Send button should be disabled until all required fields are filled and valid (channel selected, address entered, message body not empty)
- Show a loading state on the Send button while the API request is in progress
- On success: close the compose UI and show a success notification
- On failure: display the error message inline without closing the compose UI

### 6. API Integration

- **Send message:** `POST /v1/messages` via the Turumba Gateway
  - Payload should include: `channel`, `delivery_address`, `message_body` (with raw template variables)
  - The backend processor will handle variable resolution and actual delivery
- **Fetch contacts (autocomplete):** `GET /v1/contacts?filter=name:contains:{query}` for the delivery address autocomplete
- **Fetch available channels:** endpoint TBD — or derive from account configuration

---

## UI/UX Notes

- Follow the Figma design exactly for layout, spacing, colors, and component styles
- Use existing `@repo/ui` components where available (buttons, inputs, dropdowns, modals)
- Use React Hook Form + Zod for form state management and validation
- Channel-specific validation rules should switch dynamically when the user changes the channel
- The template variable inserter should not disrupt the user's typing flow — inserting a variable should place the cursor after the inserted tag

---

## Acceptance Criteria

- [ ] User can open the new message compose UI from the messaging section
- [ ] User can select a delivery channel from the available options
- [ ] Delivery address input adapts its label, placeholder, and validation based on the selected channel
- [ ] User can type a message with template variables using `{VARIABLE_NAME}` syntax
- [ ] User can insert template variables via a UI control (dropdown/button)
- [ ] Template variables are visually distinct from plain text in the composer
- [ ] Character count is displayed
- [ ] Message preview shows the message with example values replacing template variables
- [ ] Send button is disabled until the form is valid
- [ ] Successful send closes the UI and shows a success notification
- [ ] Failed send shows an error without closing the UI
- [ ] Form validation shows inline errors for invalid delivery addresses
- [ ] Cancel with unsaved content prompts for confirmation
