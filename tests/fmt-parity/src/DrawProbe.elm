port module DrawProbe exposing (main)

{-| Runs runtime/elm/Draw.elm on the cases tests/random.test.ts sends (as flags), so the test can
hold its values to runtime/ts/draw.ts's.
-}

import Draw
import Json.Decode as D
import Json.Encode as J


port out : J.Value -> Cmd msg


type alias Case =
    { form : String, seed : String, site : String, row : Int, index : Int, space : Draw.Space, count : Int, taken : List String, xs : List String, text : String, n : Int }


space : D.Decoder Draw.Space
space =
    D.field "k" D.string
        |> D.andThen
            (\k ->
                case k of
                    "int" ->
                        D.map2 Draw.IntRange (D.field "lo" D.int) (D.field "hi" D.int)

                    "text" ->
                        D.map2 Draw.Chars (D.field "n" D.int) (D.field "chars" D.string)

                    _ ->
                        D.map Draw.Names (D.field "values" (D.list D.string))
            )


opt : String -> D.Decoder a -> a -> D.Decoder a
opt name d default =
    D.oneOf [ D.field name d, D.succeed default ]


case_ : D.Decoder Case
case_ =
    D.map8 (\form seed site row index sp count taken -> \xs text n -> Case form seed site row index sp count taken xs text n)
        (D.field "form" D.string)
        (opt "seed" D.string "")
        (opt "site" D.string "")
        (opt "row" D.int 0)
        (opt "index" D.int 0)
        (opt "space" space (Draw.IntRange 0 0))
        (opt "count" D.int 0)
        (opt "taken" (D.list D.string) [])
        |> D.andThen (\f -> D.map3 f (opt "xs" (D.list D.string) []) (opt "text" D.string "") (opt "n" D.int 0))


maybeString : Maybe String -> J.Value
maybeString =
    Maybe.map J.string >> Maybe.withDefault J.null


run : D.Value -> Case -> J.Value
run steer c =
    let
        src =
            if c.form == "fromBase" then
                Draw.fromBase c.seed c.n steer

            else
                Draw.source c.seed steer
    in
    case c.form of
        "one" ->
            J.string (Draw.one src c.site c.row c.index c.space)

        "fromBase" ->
            J.string (Draw.one src c.site c.row c.index c.space)

        "many" ->
            J.list J.string (Draw.many src c.site c.row c.count c.space)

        "notAmong" ->
            maybeString (Draw.notAmong src c.site c.row c.space c.taken)

        "shuffle" ->
            J.list J.string (Draw.shuffle src c.site c.row c.xs)

        "pick" ->
            maybeString (Draw.pick src c.site c.row c.xs)

        "read" ->
            maybeString
                (case c.space of
                    Draw.Chars n chars ->
                        Draw.readCode n chars (c.index == 1) c.text

                    _ ->
                        Nothing
                )

        _ ->
            J.null


main : Program D.Value () ()
main =
    Platform.worker
        { init =
            \flags ->
                let
                    steer =
                        Result.withDefault J.null (D.decodeValue (D.field "steer" D.value) flags)

                    cases =
                        Result.withDefault [] (D.decodeValue (D.field "cases" (D.list D.value)) flags)
                in
                ( (), out (J.list (\v -> Result.withDefault J.null (Result.map (run steer) (D.decodeValue case_ v))) cases) )
        , update = \_ m -> ( m, Cmd.none )
        , subscriptions = \_ -> Sub.none
        }
