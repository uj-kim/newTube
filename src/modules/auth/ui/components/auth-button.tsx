import { Button } from "@/components/ui/button";
import { UserCircleIcon } from "lucide-react";

export const AuthButton = () => {
  // TODO: 다른 인증상태들 추가
  return (
    <Button
      variant="outline"
      className="px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-500 border-blue-500/20 rounded-full shadow-none"
    >
      {/* NOTE: shadcn Button svg 사이즈 조절은 [&svg]:size-5 이렇게 지정 */}
      <UserCircleIcon />
      Sign in
    </Button>
  );
};
