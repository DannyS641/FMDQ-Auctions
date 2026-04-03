const eyeIcon = `
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" class="h-5 w-5">
    <path d="M2.25 12S5.6 5.75 12 5.75 21.75 12 21.75 12 18.4 18.25 12 18.25 2.25 12 2.25 12Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M12 15.25A3.25 3.25 0 1 0 12 8.75a3.25 3.25 0 0 0 0 6.5Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
`;

const eyeOffIcon = `
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" class="h-5 w-5">
    <path d="M3 3l18 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    <path d="M10.58 10.58A2 2 0 0 0 12 14a2 2 0 0 0 1.42-.58" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M9.2 5.96A10.67 10.67 0 0 1 12 5.75c6.4 0 9.75 6.25 9.75 6.25a18.2 18.2 0 0 1-4.36 4.69M6.26 7.96A17.98 17.98 0 0 0 2.25 12S5.6 18.25 12 18.25c1.41 0 2.7-.3 3.86-.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
`;

export const bindPasswordVisibilityToggle = (inputId: string, buttonId: string) => {
  const input = document.querySelector<HTMLInputElement>(`#${inputId}`);
  const button = document.querySelector<HTMLButtonElement>(`#${buttonId}`);
  if (!input || !button) return;

  const setButtonState = (isVisible: boolean) => {
    button.innerHTML = isVisible ? eyeOffIcon : eyeIcon;
    button.setAttribute(
      "aria-label",
      isVisible ? `Hide ${input.placeholder || "password"}` : `Show ${input.placeholder || "password"}`
    );
  };

  setButtonState(input.type !== "password");

  button.addEventListener("click", () => {
    const shouldShow = input.type === "password";
    input.type = shouldShow ? "text" : "password";
    setButtonState(shouldShow);
  });
};
