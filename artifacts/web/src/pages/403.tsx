import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ShieldAlert, ArrowLeft } from "lucide-react";

export default function Forbidden() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      <div className="absolute inset-0 z-0 opacity-[0.02] pointer-events-none" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noiseFilter\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.65\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noiseFilter)\'/%3E%3C/svg%3E")' }}></div>
      
      <div className="w-full max-w-md text-center z-10 animate-in fade-in zoom-in duration-500">
        <div className="mx-auto h-20 w-20 bg-destructive/10 rounded-full flex items-center justify-center mb-6">
          <ShieldAlert className="h-10 w-10 text-destructive" />
        </div>
        
        <h1 className="text-4xl font-bold tracking-tight mb-2">Access Denied</h1>
        <h2 className="text-xl text-muted-foreground font-mono mb-6">Error 403</h2>
        
        <div className="bg-card border rounded-xl p-6 mb-8 text-left shadow-sm">
          <p className="text-sm leading-relaxed">
            You do not have the required permissions to access this page. If you believe this is an error, please contact your platform administrator to request access updates to your current role.
          </p>
        </div>
        
        <Link href="/dashboard">
          <Button size="lg" className="w-full sm:w-auto">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Return to Dashboard
          </Button>
        </Link>
      </div>
    </div>
  );
}
