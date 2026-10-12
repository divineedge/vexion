import React from 'react';
import { useParams } from 'wouter';
import { useGetPublicInvoice } from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { XCircle } from 'lucide-react';
import { InvoiceDocument } from '@/components/documents/InvoiceDocument';

export default function InvoicePublicPage() {
  const { token } = useParams<{ token: string }>();

  const { data: invoice, isLoading, error } = useGetPublicInvoice(token!, {
    query: { enabled: !!token, queryKey: ['getPublicInvoice', token] },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <p className="text-muted-foreground">Loading invoice…</p>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-8 pb-8 text-center">
            <XCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Invoice Not Found</h2>
            <p className="text-muted-foreground">This invoice link is invalid or has been removed.</p>
          </CardContent>
        </Card>
      </div>
    );
  }


  return <InvoiceDocument invoice={invoice} />;
}
