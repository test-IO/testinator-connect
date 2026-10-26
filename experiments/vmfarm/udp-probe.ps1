# Checks that outbound UDP and its replies work, by sending a STUN binding request (RFC 8489).
param(
    [string[]]$Servers = @('stun.l.google.com:19302', 'stun.cloudflare.com:3478')
)

foreach ($server in $Servers) {
    $name, $port = $server.Split(':')
    $udp = New-Object System.Net.Sockets.UdpClient
    $udp.Client.ReceiveTimeout = 3000
    try {
        $transactionId = New-Object byte[] 12
        (New-Object System.Random).NextBytes($transactionId)
        $request = [byte[]](0x00, 0x01, 0x00, 0x00, 0x21, 0x12, 0xA4, 0x42) + $transactionId

        $udp.Connect($name, [int]$port)
        $timer = [Diagnostics.Stopwatch]::StartNew()
        [void]$udp.Send($request, $request.Length)
        $remote = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
        $response = $udp.Receive([ref]$remote)
        $elapsed = $timer.ElapsedMilliseconds

        $mapped = 'unknown'
        $offset = 20
        while ($offset + 4 -le $response.Length) {
            $type = ($response[$offset] -shl 8) -bor $response[$offset + 1]
            $length = ($response[$offset + 2] -shl 8) -bor $response[$offset + 3]
            if ($type -eq 0x0020 -and $response[$offset + 5] -eq 1) {
                $mappedPort = ((($response[$offset + 6] -shl 8) -bor $response[$offset + 7]) -bxor 0x2112)
                $mappedIp = @(
                    ($response[$offset + 8] -bxor 0x21),
                    ($response[$offset + 9] -bxor 0x12),
                    ($response[$offset + 10] -bxor 0xA4),
                    ($response[$offset + 11] -bxor 0x42)
                ) -join '.'
                $mapped = "${mappedIp}:$mappedPort"
            }
            $offset += 4 + [math]::Ceiling($length / 4) * 4
        }
        "OK    $server  $elapsed ms  public address $mapped"
    }
    catch {
        "FAIL  $server  $($_.Exception.Message)"
    }
    finally {
        $udp.Close()
    }
}
