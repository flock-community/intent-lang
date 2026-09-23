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


type alias Wire =
    { on : String, target : String, key : String, text : String, value : String }


noWire : Wire
noWire =
    { on = "", target = "", key = "", text = "", value = "" }


wireDecoder : D.Decoder Wire
wireDecoder =
    let
        opt name =
            D.oneOf [ D.field name D.string, D.succeed "" ]
    in
    D.map5 Wire (opt "on") (opt "target") (opt "key") (opt "text") (opt "value")


encode : Node -> J.Value
encode node =
    case node of
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
    view "" "" node


view : String -> String -> Node -> Html Wire
view list key node =
    let
        target n =
            if list == "" then
                n

            else
                list ++ "." ++ n

        wire on n =
            { noWire | on = on, target = target n, key = key }
    in
    case node of
        NScreen title c ->
            Html.main_ [ A.class "screen" ] (Html.h1 [] [ Html.text title ] :: List.map (view list key) c)

        NHeading v ->
            Html.h2 [ A.class "heading" ] [ Html.text v ]

        NText n v ->
            Html.p [ A.class "text", A.attribute "data-name" n ] [ Html.text v ]

        NField n label v ->
            Html.label [ A.class "field" ]
                ((if label == "" then
                    []

                  else
                    [ Html.span [] [ Html.text label ] ]
                 )
                    ++ [ Html.input [ A.value v, E.onInput (\t -> { noWire | on = "input", target = target n, key = key, text = t }) ] [] ]
                )

        NButton n label enabled ->
            Html.button [ A.class "button", A.disabled (not enabled), E.onClick (wire "click" n) ] [ Html.text label ]

        NCheckbox n label checked ->
            Html.label [ A.class "checkbox" ]
                [ Html.input [ A.type_ "checkbox", A.checked checked, E.onClick (wire "toggle" n) ] []
                , Html.span [] [ Html.text label ]
                ]

        NProgress _ _ v ->
            Html.progress [ A.class "progress", A.max "100", A.value (String.fromInt v) ] []

        NSelect n label options v ->
            Html.div [ A.class "select" ]
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
                                , E.onClick { noWire | on = "choose", target = target n, key = key, value = o }
                                ]
                                [ Html.text o ]
                        )
                        options
                )

        NList n rows ->
            Html.ul [ A.class "list" ] (List.map (\( k, c ) -> Html.li [ A.class "row" ] (List.map (view n k) c)) rows)

        NSection _ label c ->
            Html.section [ A.class "section" ]
                ((if label == "" then
                    []

                  else
                    [ Html.h2 [] [ Html.text label ] ]
                 )
                    ++ List.map (view list key) c
                )
