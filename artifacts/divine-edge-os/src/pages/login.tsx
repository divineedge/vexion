import React from 'react';
import { useLocation } from 'wouter';
import { useAuth, MOCK_USERS } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ShieldAlert, Wrench, Briefcase } from 'lucide-react';

export default function LoginPage() {
  const { login } = useAuth();
  const [, setLocation] = useLocation();

  const handleLogin = (user: typeof MOCK_USERS[0]) => {
    login(user);
    if (user.role === 'technician') {
      setLocation('/schedule');
    } else {
      setLocation('/dashboard');
    }
  };

  const getRoleIcon = (role: string) => {
    switch(role) {
      case 'company_owner': return <ShieldAlert className="w-5 h-5 text-primary" />;
      case 'office_manager': return <Briefcase className="w-5 h-5 text-blue-500" />;
      case 'technician': return <Wrench className="w-5 h-5 text-orange-500" />;
      default: return null;
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md text-center mb-8">
        <div className="w-16 h-16 bg-primary rounded-2xl mx-auto mb-6 flex items-center justify-center shadow-lg shadow-primary/20">
          <span className="text-white text-3xl font-bold">D</span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">Divine Edge OS</h1>
        <p className="text-muted-foreground">Select a profile to enter mission control.</p>
      </div>

      <div className="w-full max-w-sm space-y-4">
        {MOCK_USERS.map((user) => (
          <button 
            key={user.id} 
            className="w-full text-left" 
            onClick={() => handleLogin(user)}
          >
            <Card className="hover-elevate transition-all border-border hover:border-primary/50 group">
              <CardContent className="p-4 flex items-center gap-4">
                <Avatar className="w-12 h-12 border border-border group-hover:border-primary/20 transition-colors">
                  <AvatarFallback className="bg-muted text-muted-foreground font-semibold">
                    {user.name.split(' ').map(n => n[0]).join('')}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-foreground truncate">{user.name}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    {getRoleIcon(user.role)}
                    <span className="text-xs text-muted-foreground capitalize">{user.role.replace('_', ' ')}</span>
                  </div>
                </div>
                <Badge variant={user.planTier === 'enterprise' ? 'default' : user.planTier === 'professional' ? 'secondary' : 'outline'} className="uppercase text-[10px]">
                  {user.planTier}
                </Badge>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>
    </div>
  );
}
