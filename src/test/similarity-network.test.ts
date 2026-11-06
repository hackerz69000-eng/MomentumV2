import { describe, expect, it } from "vitest";
import { isPrivateAddress } from "@/routes/api/similarity-discovery";

describe("similarity source address filtering", () => {
  it.each([
    "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.1.1",
    "172.16.0.1", "192.168.1.1", "192.0.2.3", "198.51.100.8", "203.0.113.4",
    "224.0.0.1", "::", "::1", "fe80::1", "fc00::1", "fd12::1", "ff02::1",
    "::ffff:7f00:1", "2001:db8::1", "2001:0db8::1", "2002:7f00:0001::1",
  ])("rejects non-public address %s", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "2001:4860:4860::8888"])("allows public address %s", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});
