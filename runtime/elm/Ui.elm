module Ui exposing (Node(..), Wire, encode, noWire, render, wireDecoder)

{-| Screen nodes, wire events and the renderer. Shared by every Elm build.
-}

import Html exposing (Html)
import Html.Attributes as A
import Html.Events as E
import Json.Decode as D
import Json.Encode as J


type Node
    = NScreen String (List Node)
    | NHeading String
    | NText String String
    | NField String String String
    | NButton String String Bool
    | NCheckbox String String Bool
    | NProgress String String Int
    | NSelect String String (List String) String
    | NList String (List ( String, List Node ))
    | NSection String String (List Node)
      -- 1.1: what a host renders the node by (`as`, `tone`), never how it looks
    | NStyled (List ( String, String )) Node


{-| An event: `key` is the row's key; `keys` a row inside a row's path of keys, the outer row's first
(empty for a top-level element or a row of a top-level list).
-}
type alias Wire =
    { on : String, target : String, key : String, keys : List String, text : String, value : String }


noWire : Wire
noWire =
    { on = "", target = "", key = "", keys = [], text = "", value = "" }


wireDecoder : D.Decoder Wire
wireDecoder =
    let
        opt name =
            D.oneOf [ D.field name D.string, D.succeed "" ]
    in
    D.map6 Wire (opt "on") (opt "target") (opt "key") (D.oneOf [ D.field "keys" (D.list D.string), D.succeed [] ]) (opt "text") (opt "value")


encode : Node -> J.Value
encode node =
    case node of
        NStyled attrs inner ->
            case D.decodeValue (D.keyValuePairs D.value) (encode inner) of
                Ok fields ->
                    J.object (List.reverse fields ++ List.map (\( k, v ) -> ( k, J.string v )) attrs)

                Err _ ->
                    encode inner

        NScreen title c ->
            J.object [ ( "k", J.string "screen" ), ( "title", J.string title ), ( "c", J.list encode c ) ]

        NHeading v ->
            J.object [ ( "k", J.string "heading" ), ( "v", J.string v ) ]

        NText n v ->
            J.object [ ( "k", J.string "text" ), ( "n", J.string n ), ( "v", J.string v ) ]

        NField n label v ->
            J.object [ ( "k", J.string "field" ), ( "n", J.string n ), ( "label", J.string label ), ( "v", J.string v ) ]

        NButton n label enabled ->
            J.object [ ( "k", J.string "button" ), ( "n", J.string n ), ( "label", J.string label ), ( "enabled", J.bool enabled ) ]

        NCheckbox n label checked ->
            J.object [ ( "k", J.string "checkbox" ), ( "n", J.string n ), ( "label", J.string label ), ( "checked", J.bool checked ) ]

        NProgress n label v ->
            J.object [ ( "k", J.string "progress" ), ( "n", J.string n ), ( "label", J.string label ), ( "v", J.int v ) ]

        NSelect n label options v ->
            J.object [ ( "k", J.string "select" ), ( "n", J.string n ), ( "label", J.string label ), ( "options", J.list J.string options ), ( "v", J.string v ) ]

        NList n rows ->
            J.object
                [ ( "k", J.string "list" )
                , ( "n", J.string n )
                , ( "rows", J.list (\( key, c ) -> J.object [ ( "key", J.string key ), ( "c", J.list encode c ) ]) rows )
                ]

        NSection n label c ->
            J.object [ ( "k", J.string "section" ), ( "n", J.string n ), ( "label", J.string label ), ( "c", J.list encode c ) ]


render : Node -> Html Wire
render node =
    view [] [] node


{-| A node inside the rows `keys` of the lists `lists` (outermost first: a row inside a row has two). -}
view : List String -> List String -> Node -> Html Wire
view lists keys node =
    let
        target n =
            String.join "." (lists ++ [ n ])

        key =
            Maybe.withDefault "" (List.head (List.reverse keys))

        path =
            if List.length keys > 1 then
                keys

            else
                []

        wire on n =
            { noWire | on = on, target = target n, key = key, keys = path }
    in
    case node of
        NStyled attrs inner ->
            let
                -- A dialog or drawer: Escape inside it dismisses it (1.1; the app decides what that does).
                onEscape =
                    case inner of
                        NSection n _ _ ->
                            if List.any (\( k, v ) -> k == "as" && (v == "dialog" || v == "drawer")) attrs then
                                [ E.stopPropagationOn "keydown"
                                    (D.field "key" D.string
                                        |> D.andThen
                                            (\k ->
                                                if k == "Escape" then
                                                    D.succeed ( wire "dismiss" n, True )

                                                else
                                                    D.fail "not Escape"
                                            )
                                    )
                                ]

                            else
                                []

                        _ ->
                            []
            in
            Html.div (A.style "display" "contents" :: onEscape ++ List.map (\( k, v ) -> A.attribute ("data-" ++ k) v) attrs) [ view lists keys inner ]

        NScreen title c ->
            Html.main_ [ A.class "screen" ] (Html.h1 [] [ Html.text title ] :: List.map (view lists keys) c)

        NHeading v ->
            Html.h2 [ A.class "heading" ] [ Html.text v ]

        NText n v ->
            Html.p [ A.class "text", A.attribute "data-name" n, A.attribute "data-el" n ] [ Html.text v ]

        NField n label v ->
            Html.label [ A.class "field" ]
                ((if label == "" then
                    []

                  else
                    [ Html.span [] [ Html.text label ] ]
                 )
                    ++ [ Html.input [ A.value v, A.attribute "data-el" n, E.onInput (\t -> { noWire | on = "input", target = target n, key = key, keys = path, text = t }) ] [] ]
                )

        NButton n label enabled ->
            Html.button [ A.class "button", A.disabled (not enabled), A.attribute "data-el" n, E.onClick (wire "click" n) ] [ Html.text label ]

        NCheckbox n label checked ->
            Html.label [ A.class "checkbox" ]
                [ Html.input [ A.type_ "checkbox", A.checked checked, A.attribute "data-el" n, E.onClick (wire "toggle" n) ] []
                , Html.span [] [ Html.text label ]
                ]

        NProgress n _ v ->
            Html.progress [ A.class "progress", A.max "100", A.value (String.fromInt v), A.attribute "data-el" n ] []

        NSelect n label options v ->
            Html.div [ A.class "select", A.attribute "data-el" n ]
                ((if label == "" then
                    []

                  else
                    [ Html.span [] [ Html.text label ] ]
                 )
                    ++ List.map
                        (\o ->
                            Html.button
                                [ A.class
                                    (if o == v then
                                        "option chosen"

                                     else
                                        "option"
                                    )
                                , A.attribute "data-option" o
                                , A.attribute "aria-pressed"
                                    (if o == v then
                                        "true"

                                     else
                                        "false"
                                    )
                                , E.onClick { noWire | on = "choose", target = target n, key = key, keys = path, value = o }
                                ]
                                [ Html.text o ]
                        )
                        options
                )

        NList n rows ->
            Html.ul [ A.class "list", A.attribute "data-el" n ] (List.map (\( k, c ) -> Html.li [ A.class "row", A.attribute "data-row" k ] (List.map (view (lists ++ [ n ]) (keys ++ [ k ])) c)) rows)

        NSection n label c ->
            Html.section [ A.class "section", A.attribute "data-el" n ]
                ((if label == "" then
                    []

                  else
                    [ Html.h2 [] [ Html.text label ] ]
                 )
                    ++ List.map (view lists keys) c
                )
