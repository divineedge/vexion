import React, { useState } from 'react';
import { useListJobs, getListJobsQueryKey } from '@workspace/api-client-react';
import { useAuth } from '@/contexts/AuthContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, MapPin, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, format, isSameDay, addWeeks, subWeeks, addMonths, subMonths } from 'date-fns';

export default function SchedulePage() {
  const { user, isTechnician } = useAuth();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<'week' | 'month'>('week');

  // If technician, only show their jobs
  const assigneeId = isTechnician && user ? user.id : undefined;

  const start = view === 'week' ? startOfWeek(currentDate) : startOfMonth(currentDate);
  const end = view === 'week' ? endOfWeek(currentDate) : endOfMonth(currentDate);

  const { data: jobs, isLoading } = useListJobs(
    { 
      startDate: start.toISOString(), 
      endDate: end.toISOString(),
      assigneeId 
    }, 
    { 
      query: { 
        queryKey: getListJobsQueryKey({ 
          startDate: start.toISOString(), 
          endDate: end.toISOString(),
          assigneeId 
        }) 
      } 
    }
  );

  const days = eachDayOfInterval({ start, end });

  const getJobsForDay = (date: Date) => {
    return jobs?.filter(job => isSameDay(new Date(job.scheduledAt), date)) || [];
  };

  const nextRange = () => {
    setCurrentDate(prev => view === 'week' ? addWeeks(prev, 1) : addMonths(prev, 1));
  };

  const prevRange = () => {
    setCurrentDate(prev => view === 'week' ? subWeeks(prev, 1) : subMonths(prev, 1));
  };

  const statusColors: Record<string, string> = {
    scheduled: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
    in_progress: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
    completed: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
    cancelled: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800',
    on_hold: 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800/50 dark:text-gray-300 dark:border-gray-700'
  };

  return (
    <div className="space-y-6 h-full flex flex-col animate-in fade-in duration-500">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Schedule</h1>
          <p className="text-muted-foreground mt-1">Manage field assignments and dispatches.</p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center rounded-md border p-1 bg-muted/50">
            <Button variant={view === 'week' ? 'secondary' : 'ghost'} size="sm" onClick={() => setView('week')} className="h-7 text-xs px-3">Week</Button>
            <Button variant={view === 'month' ? 'secondary' : 'ghost'} size="sm" onClick={() => setView('month')} className="h-7 text-xs px-3">Month</Button>
          </div>
          
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={prevRange}><ChevronLeft className="w-4 h-4" /></Button>
            <div className="min-w-[140px] text-center font-medium">
              {view === 'week' ? `${format(start, 'MMM d')} - ${format(end, 'MMM d, yyyy')}` : format(currentDate, 'MMMM yyyy')}
            </div>
            <Button variant="outline" size="icon" onClick={nextRange}><ChevronRight className="w-4 h-4" /></Button>
          </div>

          {!isTechnician && <Button className="gap-2">New Job</Button>}
        </div>
      </div>

      <Card className="flex-1 flex flex-col min-h-[600px] overflow-hidden">
        {/* Calendar Grid Header */}
        <div className="grid grid-cols-7 border-b shrink-0 bg-muted/30">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="py-3 text-center text-sm font-semibold text-muted-foreground border-r last:border-r-0">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Grid Body */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">Loading schedule...</div>
          ) : (
            <div className={`grid grid-cols-7 h-full ${view === 'month' ? 'auto-rows-[minmax(120px,1fr)]' : 'auto-rows-[minmax(300px,1fr)]'}`}>
              {days.map((day, i) => {
                const dayJobs = getJobsForDay(day);
                const isToday = isSameDay(day, new Date());
                
                return (
                  <div key={day.toISOString()} className={`border-r border-b p-2 flex flex-col ${view === 'month' ? 'min-h-[120px]' : 'min-h-[300px]'} ${!isSameDay(day, currentDate) && view === 'month' && day.getMonth() !== currentDate.getMonth() ? 'bg-muted/10' : ''}`}>
                    <div className="flex justify-between items-center mb-2">
                      <span className={`text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full ${isToday ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>
                        {format(day, 'd')}
                      </span>
                      {dayJobs.length > 0 && <span className="text-xs text-muted-foreground">{dayJobs.length} jobs</span>}
                    </div>
                    
                    <div className="flex-1 space-y-1.5 overflow-y-auto pr-1 custom-scrollbar">
                      {dayJobs.map(job => (
                        <div 
                          key={job.id} 
                          className={`p-2 rounded border text-xs cursor-pointer hover:shadow-md transition-shadow ${statusColors[job.status] || statusColors.scheduled}`}
                        >
                          <div className="font-semibold truncate">{job.title}</div>
                          {!isTechnician && job.assigneeName && (
                            <div className="mt-1 flex items-center gap-1 opacity-80">
                              <div className="w-1.5 h-1.5 rounded-full bg-current" />
                              <span className="truncate">{job.assigneeName}</span>
                            </div>
                          )}
                          <div className="mt-1 flex items-center gap-1 opacity-80">
                            <Clock className="w-3 h-3" />
                            <span>{format(new Date(job.scheduledAt), 'h:mm a')}</span>
                          </div>
                          {job.customerName && (
                            <div className="mt-0.5 truncate opacity-80">{job.customerName}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
