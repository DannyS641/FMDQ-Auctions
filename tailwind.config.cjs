module.exports = {
  content: ["./index.html", "./bidding.html", "./item.html", "./src/**/*.{ts,tsx}"] ,
  theme: {
    extend: {
      colors: {
        ink: "#0B0E12",
        ash: "#E6E8EB",
        neon: "#1d326c",
        gold: "#cc9933",
        tide: "#23D7C5",
        dusk: "#131823",
        slate: "#7D8799"
      },
      fontFamily: {
        display: ["\"Space Grotesk\"", "system-ui", "sans-serif"],
        body: ["\"Source Serif 4\"", "Georgia", "serif"]
      },
      boxShadow: {
        glow: "0 0 40px rgba(29, 50, 108, 0.3)",
        tide: "0 0 50px rgba(35, 215, 197, 0.35)"
      }
    }
  },
  plugins: []
};
