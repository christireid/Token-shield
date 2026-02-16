"use client"

import * as React from "react"
import { useDashboard, type UserBudget } from "./dashboard-provider"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { MoreHorizontal, Plus, RotateCcw, Trash2, ArrowUpDown, Pencil } from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"

const TIER_BADGE_CLASSES: Record<string, string> = {
  standard: "border-border/40 bg-secondary/40 text-muted-foreground",
  premium: "border-[hsl(38,92%,50%)]/30 bg-[hsl(38,92%,50%)]/10 text-[hsl(38,92%,65%)]",
  unlimited: "border-primary/30 bg-primary/10 text-primary",
}

const StatusBadge = React.memo(function StatusBadge({ user }: { user: UserBudget }) {
  if (user.isOverBudget) {
    return (
      <Badge
        variant="outline"
        className="border-[hsl(0,72%,51%)]/30 bg-[hsl(0,72%,51%)]/10 text-[hsl(0,72%,65%)]"
      >
        Over Budget
      </Badge>
    )
  }
  if (user.percentUsed.daily >= 80 || user.percentUsed.monthly >= 80) {
    return (
      <Badge
        variant="outline"
        className="border-[hsl(38,92%,50%)]/30 bg-[hsl(38,92%,50%)]/10 text-[hsl(38,92%,65%)]"
      >
        Warning
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
      OK
    </Badge>
  )
})

const PercentBar = React.memo(function PercentBar({ percent }: { percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent))
  const color =
    clamped >= 80 ? "bg-[hsl(0,72%,51%)]" : clamped >= 60 ? "bg-[hsl(38,92%,50%)]" : "bg-primary"
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-16 overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-label="Budget usage percentage"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
        {clamped.toFixed(0)}%
      </span>
    </div>
  )
})

/* ---- Inline edit cell ---- */
function EditableLimit({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(String(value))
  const inputRef = React.useRef<HTMLInputElement>(null)
  const committedRef = React.useRef(false)

  React.useEffect(() => {
    if (editing) {
      committedRef.current = false
      setDraft(value.toFixed(0))
      const timeoutId = setTimeout(() => inputRef.current?.select(), 0)
      return () => clearTimeout(timeoutId)
    }
  }, [editing, value])

  const [invalid, setInvalid] = React.useState(false)
  const invalidTimerRef = React.useRef<ReturnType<typeof setTimeout>>(undefined)

  React.useEffect(() => {
    return () => clearTimeout(invalidTimerRef.current)
  }, [])

  const commit = () => {
    if (committedRef.current) return
    committedRef.current = true
    const parsed = parseFloat(draft)
    if (isNaN(parsed) || parsed < 0 || parsed > 1_000_000) {
      setInvalid(true)
      clearTimeout(invalidTimerRef.current)
      invalidTimerRef.current = setTimeout(() => setInvalid(false), 1000)
      setDraft(value.toFixed(0))
      setEditing(false)
      return
    }
    onSave(parsed)
    setEditing(false)
  }

  if (editing) {
    return (
      <Input
        ref={inputRef}
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit()
          if (e.key === "Escape") setEditing(false)
        }}
        className={cn(
          "h-6 w-16 border-border/50 bg-secondary/50 px-1 font-mono text-xs",
          invalid && "border-destructive",
        )}
        min={0}
      />
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="group/edit inline-flex items-center gap-1 rounded px-1 py-0.5 font-mono text-xs tabular-nums text-foreground transition-colors hover:bg-secondary/50"
      aria-label="Edit limit"
    >
      ${value.toFixed(0)}
      <Pencil className="h-2.5 w-2.5 text-muted-foreground/0 transition-colors group-hover/edit:text-muted-foreground" />
    </button>
  )
}

/* ---- Add user dialog ---- */
function AddUserDialog() {
  const { addUser } = useDashboard()
  const { toast } = useToast()
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState("")
  const [tier, setTier] = React.useState<"standard" | "premium" | "unlimited">("standard")
  const [dailyLimit, setDailyLimit] = React.useState("10")
  const [monthlyLimit, setMonthlyLimit] = React.useState("200")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    const sanitizedName = name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, "_")
    const userId = `usr_${sanitizedName}_${Date.now().toString(36)}`
    addUser({
      userId,
      displayName: name.trim(),
      tier,
      limits: {
        daily: parseFloat(dailyLimit) || 10,
        monthly: parseFloat(monthlyLimit) || 200,
      },
    })
    toast({ title: "User added", description: `${name.trim()} has been added successfully.` })
    setName("")
    setTier("standard")
    setDailyLimit("10")
    setMonthlyLimit("200")
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 border-border/50 text-xs">
          <Plus className="h-3.5 w-3.5" />
          Add User
        </Button>
      </DialogTrigger>
      <DialogContent className="border-border/50 bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground">Add User Budget</DialogTitle>
          <DialogDescription>
            Configure a new user with spending limits and a tier assignment.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="user-name" className="text-xs">
              Display Name
            </Label>
            <Input
              id="user-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Jane Smith"
              className="border-border/50 bg-secondary/30 text-sm"
              maxLength={100}
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="tier-select" className="text-xs">
              Tier
            </Label>
            <Select value={tier} onValueChange={(v) => setTier(v as typeof tier)}>
              <SelectTrigger id="tier-select" className="border-border/50 bg-secondary/30 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">Standard</SelectItem>
                <SelectItem value="premium">Premium</SelectItem>
                <SelectItem value="unlimited">Unlimited</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="daily-limit" className="text-xs">
                Daily Limit ($)
              </Label>
              <Input
                id="daily-limit"
                type="number"
                value={dailyLimit}
                onChange={(e) => setDailyLimit(e.target.value)}
                className="border-border/50 bg-secondary/30 text-sm"
                min={0}
              />
            </div>
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="monthly-limit" className="text-xs">
                Monthly Limit ($)
              </Label>
              <Input
                id="monthly-limit"
                type="number"
                value={monthlyLimit}
                onChange={(e) => setMonthlyLimit(e.target.value)}
                className="border-border/50 bg-secondary/30 text-sm"
                min={0}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button type="submit" className="text-xs">
              Add User
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ---- Main table ---- */

type SortKey = "displayName" | "tier" | "dailySpend" | "monthlySpend" | "percentUsed"

function getSortValue(u: UserBudget, key: SortKey): number | string {
  switch (key) {
    case "displayName":
      return u.displayName
    case "tier":
      return u.tier
    case "dailySpend":
      return u.spend.daily
    case "monthlySpend":
      return u.spend.monthly
    case "percentUsed":
      return Math.max(u.percentUsed.daily, u.percentUsed.monthly)
  }
}

const SortHeader = React.memo(function SortHeader({
  label,
  sortKeyValue,
  currentSortKey,
  currentSortDir,
  onSort,
}: {
  label: string
  sortKeyValue: SortKey
  currentSortKey: SortKey
  currentSortDir: "asc" | "desc"
  onSort: (key: SortKey) => void
}) {
  const isActive = currentSortKey === sortKeyValue
  const ariaSortValue = isActive ? (currentSortDir === "asc" ? "ascending" : "descending") : "none"
  return (
    <TableHead
      className="cursor-pointer text-xs select-none"
      onClick={() => onSort(sortKeyValue)}
      tabIndex={0}
      aria-sort={ariaSortValue}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onSort(sortKeyValue)
        }
      }}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown
          className={cn("h-3 w-3", isActive ? "text-foreground" : "text-muted-foreground/40")}
        />
      </span>
    </TableHead>
  )
})

export function UserBudgetTable() {
  const { data, updateUserBudget, removeUser, resetUserSpend } = useDashboard()
  const { toast } = useToast()
  const [sortKey, setSortKey] = React.useState<SortKey>("percentUsed")
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc")
  const [confirmRemoveUserId, setConfirmRemoveUserId] = React.useState<string | null>(null)
  const confirmRemoveUser = data.users.find((u) => u.userId === confirmRemoveUserId)

  const handleSort = React.useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "desc" ? "asc" : "desc"))
      } else {
        setSortKey(key)
        setSortDir("desc")
      }
    },
    [sortKey],
  )

  const sorted = React.useMemo(() => {
    return [...data.users].sort((a, b) => {
      const aVal = getSortValue(a, sortKey)
      const bVal = getSortValue(b, sortKey)
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDir === "desc" ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal)
      }
      return sortDir === "desc"
        ? (bVal as number) - (aVal as number)
        : (aVal as number) - (bVal as number)
    })
  }, [data.users, sortKey, sortDir])

  return (
    <Card className="border-border/40 bg-card/50">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-sm font-medium text-foreground">
            User Budget Management
          </CardTitle>
          <CardDescription className="text-xs">
            {data.users.length} users tracked &middot;{" "}
            {data.users.filter((u) => u.isOverBudget).length} over budget
          </CardDescription>
        </div>
        <AddUserDialog />
      </CardHeader>
      <CardContent className="overflow-x-auto p-0 pb-2">
        <Table>
          <TableHeader>
            <TableRow className="border-border/30 hover:bg-transparent">
              <SortHeader
                label="User"
                sortKeyValue="displayName"
                currentSortKey={sortKey}
                currentSortDir={sortDir}
                onSort={handleSort}
              />
              <SortHeader
                label="Tier"
                sortKeyValue="tier"
                currentSortKey={sortKey}
                currentSortDir={sortDir}
                onSort={handleSort}
              />
              <TableHead className="text-xs">Daily Spend</TableHead>
              <TableHead className="text-xs">Daily Limit</TableHead>
              <TableHead className="text-xs">Monthly Spend</TableHead>
              <TableHead className="text-xs">Monthly Limit</TableHead>
              <SortHeader
                label="Usage"
                sortKeyValue="percentUsed"
                currentSortKey={sortKey}
                currentSortDir={sortDir}
                onSort={handleSort}
              />
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="w-10 text-xs">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((user) => (
              <TableRow
                key={user.userId}
                className={cn(
                  "border-border/20 transition-colors",
                  user.isOverBudget && "bg-[hsl(0,72%,51%)]/5",
                )}
              >
                <TableCell className="py-2">
                  <div className="flex flex-col">
                    <span className="text-xs font-medium text-foreground">{user.displayName}</span>
                    <span className="font-mono text-[10px] text-muted-foreground/60">
                      {user.userId}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="py-2">
                  <Badge
                    variant="outline"
                    className={cn("text-[10px] capitalize", TIER_BADGE_CLASSES[user.tier])}
                  >
                    {user.tier}
                  </Badge>
                </TableCell>
                <TableCell className="py-2 font-mono text-xs tabular-nums text-foreground">
                  ${user.spend.daily.toFixed(2)}
                </TableCell>
                <TableCell className="py-2">
                  <EditableLimit
                    value={user.limits.daily}
                    onSave={(v) =>
                      updateUserBudget(user.userId, {
                        limits: { daily: v, monthly: user.limits.monthly },
                      })
                    }
                  />
                </TableCell>
                <TableCell className="py-2 font-mono text-xs tabular-nums text-foreground">
                  ${user.spend.monthly.toFixed(2)}
                </TableCell>
                <TableCell className="py-2">
                  <EditableLimit
                    value={user.limits.monthly}
                    onSave={(v) =>
                      updateUserBudget(user.userId, {
                        limits: { daily: user.limits.daily, monthly: v },
                      })
                    }
                  />
                </TableCell>
                <TableCell className="py-2">
                  <PercentBar
                    percent={Math.max(user.percentUsed.daily, user.percentUsed.monthly)}
                  />
                </TableCell>
                <TableCell className="py-2">
                  <StatusBadge user={user} />
                </TableCell>
                <TableCell className="py-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                        <MoreHorizontal className="h-3.5 w-3.5" />
                        <span className="sr-only">User actions</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => resetUserSpend(user.userId)}>
                        <RotateCcw className="mr-2 h-3.5 w-3.5" />
                        Reset Spend
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => setConfirmRemoveUserId(user.userId)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="mr-2 h-3.5 w-3.5" />
                        Remove User
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="h-24 text-center text-xs text-muted-foreground">
                  No users configured. Click &quot;Add User&quot; to get started.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>

      {/* Lifted outside DropdownMenu to avoid focus management conflicts */}
      <AlertDialog
        open={!!confirmRemoveUserId}
        onOpenChange={(open) => {
          if (!open) setConfirmRemoveUserId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove {confirmRemoveUser?.displayName ?? "this user"}? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmRemoveUserId) {
                  const userName = confirmRemoveUser?.displayName ?? "User"
                  removeUser(confirmRemoveUserId)
                  toast({ title: "User removed", description: `${userName} has been removed.` })
                }
                setConfirmRemoveUserId(null)
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
