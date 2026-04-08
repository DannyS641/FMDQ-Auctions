import { Link } from "react-router-dom";
import { PageShell } from "@/components/layout/PageShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <PageShell>
      <Card className="max-w-md mx-auto text-center py-12">
        <p className="text-xs uppercase tracking-[0.3em] text-slate">404</p>
        <h1 className="mt-3 text-[21px] font-semibold text-neon">Page not found</h1>
        <p className="mt-3 text-sm text-slate">
          The page you are looking for does not exist or has been moved.
        </p>
        <Link to="/bidding">
          <Button className="mt-8">Go to auction desk</Button>
        </Link>
      </Card>
    </PageShell>
  );
}
