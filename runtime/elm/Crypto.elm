module Crypto exposing (sha256)

{-| The Elm side of the `std.crypto` platform: SHA-256, pure, so a screen's `update`/`view`
can use it. Kept in step with the TypeScript implementation by the parity test
(`tests/fmt-parity`): the same inputs must give the same digests.
-}

import Bitwise as B


sha256 : String -> String
sha256 message =
    let
        bytes =
            utf8 message

        bitLength =
            List.length bytes * 8

        blocks =
            chunksOf 64 (padded bytes bitLength)
    in
    List.foldl compress initialHash blocks
        |> List.map hex32
        |> String.concat


initialHash : List Int
initialHash =
    [ 0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19 ]


k : List Int
k =
    [ 0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5, 0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174, 0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA, 0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967, 0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85, 0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070, 0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3, 0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2 ]



-- 32-bit words


add32 : Int -> Int -> Int
add32 a b =
    B.and 0xFFFFFFFF (a + b)


rotR : Int -> Int -> Int
rotR n x =
    B.or (B.shiftRightZfBy n x) (B.shiftLeftBy (32 - n) x)


nth : Int -> List Int -> Int
nth i xs =
    List.drop i xs |> List.head |> Maybe.withDefault 0


wordAt : List Int -> Int -> Int
wordAt block i =
    B.or (B.shiftLeftBy 24 (nth (i * 4) block))
        (B.or (B.shiftLeftBy 16 (nth (i * 4 + 1) block))
            (B.or (B.shiftLeftBy 8 (nth (i * 4 + 2) block)) (nth (i * 4 + 3) block))
        )


schedule : List Int -> Int -> List Int
schedule w i =
    if i >= 64 then
        List.take 64 w

    else
        let
            x =
                nth (i - 15) w

            y =
                nth (i - 2) w

            s0 =
                B.xor (B.xor (rotR 7 x) (rotR 18 x)) (B.shiftRightZfBy 3 x)

            s1 =
                B.xor (B.xor (rotR 17 y) (rotR 19 y)) (B.shiftRightZfBy 10 y)

            next =
                add32 (nth (i - 16) w) (add32 s0 (add32 (nth (i - 7) w) s1))
        in
        schedule (w ++ [ next ]) (i + 1)


compress : List Int -> List Int -> List Int
compress block hash =
    let
        w =
            schedule (List.map (wordAt block) (List.range 0 15)) 16

        step s ki wi =
            let
                s1 =
                    B.xor (B.xor (rotR 6 s.e) (rotR 11 s.e)) (rotR 25 s.e)

                ch =
                    B.xor (B.and s.e s.f) (B.and (B.complement s.e) s.g)

                t1 =
                    add32 s.h (add32 s1 (add32 ch (add32 ki wi)))

                s0 =
                    B.xor (B.xor (rotR 2 s.a) (rotR 13 s.a)) (rotR 22 s.a)

                maj =
                    B.xor (B.xor (B.and s.a s.b) (B.and s.a s.c)) (B.and s.b s.c)
            in
            { a = add32 t1 (add32 s0 maj), b = s.a, c = s.b, d = s.c, e = add32 s.d t1, f = s.e, g = s.f, h = s.g }

        start =
            { a = nth 0 hash, b = nth 1 hash, c = nth 2 hash, d = nth 3 hash, e = nth 4 hash, f = nth 5 hash, g = nth 6 hash, h = nth 7 hash }

        end =
            List.foldl (\( ki, wi ) s -> step s ki wi) start (List.map2 Tuple.pair k w)
    in
    [ add32 (nth 0 hash) end.a
    , add32 (nth 1 hash) end.b
    , add32 (nth 2 hash) end.c
    , add32 (nth 3 hash) end.d
    , add32 (nth 4 hash) end.e
    , add32 (nth 5 hash) end.f
    , add32 (nth 6 hash) end.g
    , add32 (nth 7 hash) end.h
    ]



-- bytes


utf8 : String -> List Int
utf8 s =
    String.foldr (\c acc -> encode (Char.toCode c) ++ acc) [] s


encode : Int -> List Int
encode code =
    if code < 0x80 then
        [ code ]

    else if code < 0x800 then
        [ 0xC0 + (code // 64), 0x80 + (code |> modBy 64) ]

    else if code < 0x10000 then
        [ 0xE0 + (code // 4096), 0x80 + ((code // 64) |> modBy 64), 0x80 + (code |> modBy 64) ]

    else
        [ 0xF0 + (code // 262144), 0x80 + ((code // 4096) |> modBy 64), 0x80 + ((code // 64) |> modBy 64), 0x80 + (code |> modBy 64) ]


padded : List Int -> Int -> List Int
padded bytes bitLength =
    let
        zeroPad =
            (56 - ((List.length bytes + 1) |> modBy 64)) |> modBy 64

        -- A 64-bit length, big-endian. A shift by 32 wraps in JS, so write the high word as zeros
        -- (messages are far below 2^32 bits).
        lengthBytes =
            [ 0, 0, 0, 0, B.and 255 (B.shiftRightZfBy 24 bitLength), B.and 255 (B.shiftRightZfBy 16 bitLength), B.and 255 (B.shiftRightZfBy 8 bitLength), B.and 255 bitLength ]
    in
    bytes ++ [ 0x80 ] ++ List.repeat zeroPad 0 ++ lengthBytes


chunksOf : Int -> List a -> List (List a)
chunksOf n xs =
    if List.isEmpty xs then
        []

    else
        List.take n xs :: chunksOf n (List.drop n xs)


hex32 : Int -> String
hex32 word =
    List.range 0 7
        |> List.map (\i -> nibble (B.and 15 (B.shiftRightZfBy ((7 - i) * 4) word)))
        |> String.fromList


nibble : Int -> Char
nibble n =
    Maybe.withDefault '0' (List.head (List.drop n (String.toList "0123456789abcdef")))
