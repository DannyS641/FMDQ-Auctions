export function Footer() {
  return (
    <footer className="border-t border-ink/10 bg-white">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-slate">
        <p> © {new Date().getFullYear()} FMDQ Group PLC.</p>
        {/* <p>Role-based access · Account login · Anonymous bidding</p> */}
      </div>
    </footer>
  );
}
