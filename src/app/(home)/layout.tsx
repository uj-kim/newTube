import { HomeLayout } from "@/modules/home/ui/layouts/home-layout";

// TODO: force-dynamic이 필요한지 아닌지 확인
export const dynamic = "force-dynamic";
interface LayoutProps {
  children: React.ReactNode;
}

const Layout = ({ children }: LayoutProps) => {
  return <HomeLayout>{children}</HomeLayout>;
};

export default Layout;
